/* eslint-disable no-unused-vars */
require('dotenv').config()

const accountSid = process.env.ACCOUNT_SID
const authToken = process.env.AUTH_TOKEN
const client = require('twilio')(accountSid, authToken)
const signale = require('signale')
const VoiceResponse = require('twilio').twiml.VoiceResponse
const MessagingResponse = require('twilio').twiml.MessagingResponse
const rp = require('request-promise')

const express = require('express')
const cors = require('cors')
const twilio = require('twilio')
const urlencoded = require('body-parser').urlencoded
const app = express()
const session = require('express-session')
const port = 6969

// Parse incoming POST params with Express middleware
app.use(urlencoded({ extended: false }))

const dbConnect = require('./models/db.js')

dbConnect()

app.use(cors())

const bodyParser = require('body-parser')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

const user = require('./routes/user')

app.use('/user/', user)

// Create a route that will handle Twilio webhook requests, sent as an
// HTTP POST to /voice in our application

app.post('/call/incoming', (req, res) => {
  // Get information about the incoming call, like the city associated
  // with the phone number (if Twilio can discover it)

  const twiml = new VoiceResponse()
  const caller = req.body.Caller
  signale.info(`Incoming call from ${caller}`)
  let randNum = '1234'
  const gather = twiml.gather({
    numDigits: 4,
    action: `/call/authcode/${randNum}`
  })
  gather.say(
    `Welcome to mobile captcha. Please enter the following code: ${randNum}`
  )
  // If the user doesn't enter input, loop
  twiml.redirect('/call/incoming')

  // Render the response as XML in reply to the webhook request
  res.type('text/xml')
  res.send(twiml.toString())
})

app.post('/call/authcode/:correctCode', (req, res) => {
  // Use the Twilio Node.js SDK to build an XML response
  const twiml = new VoiceResponse()

  // If the user entered digits, process their request
  signale.info(`Recieved auth code: ${req.body.Digits}`)

  if (req.body.Digits) {
    if (req.body.Digits === req.params.correctCode) {
      signale.success('Auth code corrrect - redirecting to caller')
      twiml.say('Code is correct. Redirecting you to caller...')
      twiml.dial('5106405189')
    } else {
      signale.warn('Auth code incorrect - asking again')
      twiml.say(`Sorry, the code ${req.body.Digits} is wrong :(`)
      twiml.redirect('/call/incoming')
    }
  } else {
    twiml.redirect('/call/incoming')
  }

  // Render the response as XML in reply to the webhook request
  res.type('text/xml')
  res.send(twiml.toString())
})

app.post('/sms/incoming', async (req, res) => {
  const callerNumber = req.body.From
  const proxyNumber = req.body.To
  const content = req.body.Body
  const reply = `New message from ${callerNumber}: ${content}`
  signale.note(reply)

  const ongoingSMS = await isOngoingSMS(proxyNumber, callerNumber, content)

  if (ongoingSMS) {
    signale.note('Is an ongoing SMS')
    removeOngoingSMS(proxyNumber, callerNumber)
    addToWhitelist(proxyNumber, callerNumber)
    const userNumber = ongoingSMS.number
    sendSMS(proxyNumber, userNumber, ongoingSMS.message)
    sendSMS(proxyNumber, callerNumber, 'Your number has been whitelisted. 👌')
  } else if (ongoingSMS === false) {
    signale.note('Invalid code')
    sendSMS(proxyNumber, callerNumber, 'Invalid code! 🙅‍♀️ Resend your message.')
    removeOngoingSMS(proxyNumber, callerNumber)
  } else {
    if (await isWhitelisted(proxyNumber, callerNumber)) {
      signale.note('Detected message as spam.')
      const authCode = getCode()
      sendSMS(
        proxyNumber,
        callerNumber,
        `This message was detected as spam. 🤨 Please reply with the following code: ${authCode}.`
      )
      addOngoingSMS(proxyNumber, callerNumber, authCode, reply)
    } else {
      signale.note('Not spam.')
      const user = await getUser(proxyNumber)
      sendSMS(proxyNumber, user.number, reply)
    }
  }
})

async function getUser (proxyNumber) {
  const options = {
    method: 'GET',
    url: `http://localhost:${port}/user/${proxyNumber}`,
    json: true
  }
  return rp(options)
}

async function isWhitelisted (proxyNumber, number) {
  const options = {
    method: 'GET',
    url: `http://localhost:${port}/user/${proxyNumber}`,
    json: true
  }
  return rp(options).then(user => {
    if (user && user.whitelist.includes(number)) {
      return false
    }
    return true
  })
}

async function isOngoingSMS (proxyNumber, callerNumber, content) {
  const options = {
    method: 'get',
    url: `http://localhost:${port}/user/${proxyNumber}`,
    json: true
  }
  return rp(options).then(user => {
    if (user) {
      const ongoingSMS = user.ongoingSMS.filter(
        sms => sms.callerNumber === callerNumber
      )[0]
      if (ongoingSMS) {
        if (content === ongoingSMS.code) {
          return { number: user.number, message: ongoingSMS.message }
        } else {
          return false
        }
      }
    }
    return undefined
  })
}

async function addOngoingSMS (proxyNumber, callerNumber, code, message) {
  const options = {
    method: 'post',
    url: `http://localhost:${port}/user/${proxyNumber}/ongoingSMS`,
    body: { ongoingSMS: { callerNumber, code, message } },
    json: true
  }
  rp(options)
}

async function removeOngoingSMS (proxyNumber, callerNumber) {
  const options = {
    method: 'delete',
    url: `http://localhost:${port}/user/${proxyNumber}/ongoingSMS`,
    body: { callerNumber },
    json: true
  }
  rp(options)
}

async function addToWhitelist (proxyNumber, number) {
  const options = {
    method: 'post',
    url: `http://localhost:${port}/user/${proxyNumber}/whitelist`,
    body: { whitelist: [number] },
    json: true
  }
  rp(options)
}

async function removeFromWhitelist (proxyNumber, number) {
  const options = {
    method: 'delete',
    url: `http://localhost:${port}/user/${proxyNumber}/whitelist`,
    body: { whitelist: [number] },
    json: true
  }
  rp(options)
}

function sendSMS (from, to, body) {
  client.messages.create({
    from,
    to,
    body
  })
}

function getCode () {
  return Math.round(Math.random() * 8999 + 1000)
}
// Create an HTTP server and listen for requests on port 3000
app.listen(6969, () => signale.start(`App running at port ${port}`))
