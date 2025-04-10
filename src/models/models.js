import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  full_name: String,
  phone_no: { type: String, unique: true, required: true },
  pincode: String,
  village_name: String,
  district: String,
  topic_of_interests: [String],
  is_premium: { type: Boolean, default: false },
  is_admin: { type: Boolean, default: false },
  is_blocked: { type: Boolean, default: false },
  referred_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  allow_notifications: { type: Boolean, default: false },
  search_history: [String],
});

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  description: String,
  seller_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  seller_name: { type: String, required: true },
  category: {
    type: String,
    enum: ["Farming", "Pets", "Cars", "Tools", "Furniture", "Electronics"],
    required: true,
  },
  images: [
    {
      data: Buffer,
      contentType: String,
    },
  ],
  condition: {
    type: String,
    enum: ["New", "Used - Like New", "Used - Good", "Used - Fair"],
    required: true,
  },
  available_from_date: Date,
  is_flagged: { type: Boolean, default: false },
  flagged_count: { type: Number, default: 0 },
});

const AskYourNetaSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  leader_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Leader",
    required: true,
  },
  query: { type: String, required: true },
  reply: { type: String, default: null },
  constituency: String,
  created_at: { type: Date, default: Date.now },
});

const LeaderSchema = new mongoose.Schema({
  leader_name: { type: String, required: true },
  no_of_queries: { type: Number, default: 0 },
  no_of_replies: { type: Number, default: 0 },
  constituency: String,
});

const NewsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: String,
  category: String,
  source: String,
  source_link: String,
  timestamp: { type: Date, default: Date.now },
});

const ConversationSchema = new mongoose.Schema({
  created_at: { type: Date, default: Date.now },
  last_message_at: { type: Date, default: Date.now },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    default: null,
  },
  buyer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const MessageSchema = new mongoose.Schema({
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
  },
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  message_text: String,
  sent_at: { type: Date, default: Date.now },
  message_type: {
    type: String,
    enum: ["text", "image", "video", "file"],
    required: true,
  },
});
const MpSchema = new mongoose.Schema({
  mp_name: String,
  mp_constituency: String,
  mp_mail: String,
  QuestionsAsked: {
    type: Number,
    default: 0,
  },
  QuestionsAnswered: {
    type: Number,
    default: 0,
  },
  formIds: {
    type: [String],
    default: [],
  },
});
const QuestionResponseSchema = new mongoose.Schema({
  mp_name: String,
  mp_constituency: String,
  mp_mail: String,
  formId: String,
  question: String,
  response: String,
  responded: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
});

export const User = mongoose.model("User", UserSchema);
export const Product = mongoose.model("Product", ProductSchema);
export const AskYourNeta = mongoose.model("AskYourNeta", AskYourNetaSchema);
export const Leader = mongoose.model("Leader", LeaderSchema);
export const News = mongoose.model("News", NewsSchema);
export const Conversation = mongoose.model("Conversation", ConversationSchema);
export const Message = mongoose.model("Message", MessageSchema);
export const MpModel = mongoose.model("mp_list", MpSchema, "mp_list");
export const QuestionResponseModel = mongoose.model(
  "Question",
  QuestionResponseSchema
);
