import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid"; // npm install uuid

const meetingSchema = new mongoose.Schema({
  meeting_id: {
    type: String,
    default: uuidv4, // automatically generate a UUID
    unique: true
  },
  host_id: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Meeting = mongoose.model("Meeting", meetingSchema);

export default Meeting;
