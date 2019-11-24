import mongoose from 'mongoose';


const standingSchema = new mongoose.Schema({
  contest: {
    type: mongoose.Types.ObjectId,
    required: true,
    ref: 'Contest'
  },
  user: {
    type: mongoose.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  problems: [{
    problem: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: 'Problem'
    },
    isAccepted: {
      type: Boolean,
      required: true,
      default: false,
    },
    failedSubmissions: {
      type: Number,
      required: true,
      default: 0
    },
    totalSubmissions: {
      type: Number,
      required: true,
      default: 0
    },
    isFirstAccepted: {
      type: Number,
      required: true,
      default: false
    },
  }],
  solved: {
    type: Number,
    required: true,
    default: 0
  },
  penality: {
    type: Number,
    required: true,
    default: 0
  }

});

export const Standing = mongoose.model('Standing', standingSchema);