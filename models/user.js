const mongoose = require('mongoose')
const Schema = mongoose.Schema

const userSchema = new Schema({
  proxyNumber: String,
  number: String,
  whitelist: [String],
  callHistory: [
    {
      from: String,
      to: String,
      time: Date,
      duration: Number,
      blocked: Boolean
    }
  ],
  ongoingSMS: [
    {
      callerNumber: String,
      code: String,
      message: String
    }
  ]
})

const User = mongoose.model('User', userSchema)

module.exports = User
