// export const sendmail = async (req, res) => {
//   try {

//     const { name, constituency, question} = req.body;
//     console.log(name, constituency, question);
//     if (!name || !constituency || !question) {
//       return res.status(400).json({ error: "Missing name, constituency, or question" });
//     }

//     // Step 1: Fetch MP details
//     const mp = await MpModel.findOne({
//       mp_name: name,
//       mp_constituency: constituency,
//     });

//     if (!mp) {
//       console.log("heedcd");
//       return res.status(404).json({ error: "MP not found" });
//     }

//     const receiver = mp.mp_mail; // Get MP's email from DB

//     // Step 2: Configure nodemailer
//     var transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: process.env.USER_MAIL,
//         pass: process.env.APP_PASSWORD,
//       },
//     });

//     var mailOptions = {
//       from: process.env.user_mail,
//       to: receiver,
//       subject: "Question from a citizen",
//       text: typeof question === "string" ? question : JSON.stringify(question),
//     };

//     // Step 3: Send email
//     transporter.sendMail(mailOptions, (error, info) => {
//       if (error) {
//         console.error("Error sending email:", error);
//         return res.status(500).json({ error: "Failed to send email" });
//       }
//       console.log("Email sent:", info.response);
//       res.status(200).json({ message: "Email sent successfully" });
//     });
//   } catch (err) {
//     console.error("Unexpected error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// };
// const axios = require("axios");
// const nodemailer = require("nodemailer");
// const MpModel = require("./models/mpModel"); // Adjust path to your model

// require("dotenv").config();

// export const sendmail = async (req, res) => {
//   try {
//     const { name, constituency, question } = req.body;

//     if (!name || !constituency || !question) {
//       return res
//         .status(400)
//         .json({ error: "Missing name, constituency, or question" });
//     }

//     // Step 1: Find MP in database
//     const mp = await MpModel.findOne({
//       mp_name: name,
//       mp_constituency: constituency,
//     });

//     if (!mp) {
//       return res.status(404).json({ error: "MP not found" });
//     }

//     const receiver = mp.mp_mail;

//     // Step 2: Call Apps Script to create dynamic Google Form
//     const appsScriptURL =
//       "https://script.google.com/macros/s/AKfycbx2PiyVARb2otCD8wRprlgGKHeuhHaZb87NxRjV-T-faYuIwg7SGZv-9VJwjOJAlAar/exec";
//     const params = new URLSearchParams({
//       name,
//       constituency,
//       question,
//     });

//     const response = await axios.get(`${appsScriptURL}?${params.toString()}`);
//     const formUrl = response.data;

//     // Step 3: Send Email to MP
//     const transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: process.env.user_mail,
//         pass: process.env.app_password,
//       },
//     });

//     const mailOptions = {
//       from: process.env.user_mail,
//       to: receiver,
//       subject: "Question from a citizen",
//       html: `
//         <p>Dear ${name},</p>
//         <p>You have received a new question from a citizen in ${constituency}:</p>
//         <blockquote>${question}</blockquote>
//         <p>Please respond using the link below:</p>
//         <a href="${formUrl}">Click here to answer</a>
//         <p>Regards,<br/>Citizen Connect Platform</p>
//       `,
//     };

//     transporter.sendMail(mailOptions, (error, info) => {
//       if (error) {
//         console.error("Error sending email:", error);
//         return res.status(500).json({ error: "Failed to send email" });
//       }
//       res.status(200).json({ message: "Email sent successfully", formUrl });
//     });
//   } catch (err) {
//     console.error("Unexpected error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// };

// const axios = require("axios");
// const nodemailer = require("nodemailer");
// const { google } = require("googleapis");
// const formRegistry = new Map();
// export const sendmail = async (req, res) => {
//   try {
//     const { name, constituency, question } = req.body;
//     if (!name || !constituency || !question) {
//       return res
//         .status(400)
//         .json({ error: "Missing name, constituency, or question" });
//     }

//     // Step 1: Find MP in database
//     const mp = await MpModel.findOne({
//       mp_name: name,
//       mp_constituency: constituency,
//     });
//     if (!mp) {
//       return res.status(404).json({ error: "MP not found" });
//     }

//     const receiver = mp.mp_mail;

//     // Step 2: Call Apps Script to create form
//     const appsScriptURL =
//       "https://script.google.com/macros/s/AKfycbx2PiyVARb2otCD8wRprlgGKHeuhHaZb87NxRjV-T-faYuIwg7SGZv-9VJwjOJAlAar/exec";
//     const params = new URLSearchParams({ name, constituency, question });
//     const response = await axios.get(`${appsScriptURL}?${params.toString()}`);

//     let formUrl, formId;

//     if (typeof response.data === "object") {
//       formUrl = response.data.formUrl;
//       formId = response.data.formId;
//     } else {
//       formUrl = response.data;
//       const urlMatch = formUrl.match(/\/e\/([^\/]+)/);
//       formId = urlMatch ? urlMatch[1] : null;
//     }

//     // Update form registry
//     if (formId) {
//       formRegistry.set(formId, {
//         created: new Date(),
//         name,
//         constituency,
//         question,
//         responded: false,
//         email: receiver,
//       });

//       // Update MP record in DB
//       await MpModel.findOneAndUpdate(
//         { mp_name: name, mp_constituency: constituency },
//         {
//           $inc: { numberOfQuestionsAsked: 1 },
//           $addToSet: { formIds: formId }, // prevents duplicates
//         },
//         { new: true }
//       );
//     }

//     // Step 3: Send email to MP
//     const transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: process.env.user_mail,
//         pass: process.env.app_password,
//       },
//     });

//     const mailOptions = {
//       from: process.env.user_mail,
//       to: receiver,
//       subject: "Question from a citizen",
//       html: `
//         <p>Dear ${name},</p>
//         <p>You have received a new question from a citizen in ${constituency}:</p>
//         <blockquote>${question}</blockquote>
//         <p>Please respond using the link below:</p>
//         <a href="${formUrl}">Click here to answer</a>
//         <p>Regards,<br/>Citizen Connect Platform</p>
//       `,
//     };

//     transporter.sendMail(mailOptions, (error, info) => {
//       if (error) {
//         console.error("Error sending email:", error);
//         return res.status(500).json({ error: "Failed to send email" });
//       }
//       res.status(200).json({
//         message: "Email sent successfully",
//         formUrl,
//         formId,
//       });
//     });
//   } catch (err) {
//     console.error("Unexpected error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// };

// export const checkFormResponse = async (req, res) => {
//   try {
//     const { formId } = req.params;
//     if (!formId) {
//       return res.status(400).json({ error: "Form ID is required" });
//     }

//     const auth = new google.auth.GoogleAuth({
//       keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
//       scopes: ["https://www.googleapis.com/auth/forms.responses.readonly"],
//     });

//     const client = await auth.getClient();

//     const forms = google.forms({ version: "v1", auth: client });

//     const responseData = await forms.forms.responses.list({ formId });

//     const hasResponses =
//       responseData.data.responses && responseData.data.responses.length > 0;

//     // Update registry and DB if answered
//     if (hasResponses && formRegistry.has(formId)) {
//       const meta = formRegistry.get(formId);
//       if (!meta.responded) {
//         formRegistry.set(formId, {
//           ...meta,
//           responded: true,
//           responseTimestamp: new Date(),
//         });

//         // Update MP's answered question count in DB
//         await MpModel.findOneAndUpdate(
//           { mp_name: meta.name, mp_constituency: meta.constituency },
//           { $inc: { numberOfQuestionsAnswered: 1 } },
//           { new: true }
//         );
//       }
//     }

//     return res.status(200).json({
//       hasResponse: hasResponses,
//       count: hasResponses ? responseData.data.responses.length : 0,
//       formId,
//       formInfo: formRegistry.get(formId) || null,
//     });
//   } catch (err) {
//     console.error("Error checking form response:", err);
//     res
//       .status(500)
//       .json({ error: "Error checking form response", details: err.message });
//   }
// };
