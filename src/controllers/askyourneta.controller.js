import { MpModel, QuestionResponseModel } from "../models/models.js";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { google } from "googleapis";
dotenv.config();
const formRegistry = new Map();
export const createGoogleForm = async (name, constituency, question) => {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/forms.body"],
  });

  const client = await auth.getClient();
  const forms = google.forms({ version: "v1", auth: client });

  const createResponse = await forms.forms.create({
    requestBody: {
      info: {
        title: `RESPONSE NEEDED FROM ${name}`,
      },
    },
  });

  const formId = createResponse.data.formId;
  await forms.forms.batchUpdate({
    formId,
    requestBody: {
      requests: [
        {
          updateFormInfo: {
            info: {
              description: `📣 "${question}"\n\nFrom a citizen in ${constituency}.`,
            },
            updateMask: "description",
          },
        },
        {
          createItem: {
            item: {
              title: "Your Response",
              questionItem: {
                question: {
                  required: true,
                  textQuestion: {},
                },
              },
            },
            location: {
              index: 0,
            },
          },
        },
      ],
    },
  });

  const formUrl = `https://docs.google.com/forms/d/${formId}/edit`;
  return { formId, formUrl };
};

export const sendmail = async (req, res) => {
  try {
    const { name, constituency, question } = req.body;
    console.log(name, constituency, question);
    if (!name || !constituency || !question) {
      return res
        .status(400)
        .json({ error: "Missing name, constituency, or question" });
    }

    const mp = await MpModel.findOne({
      mp_name: name,
      mp_constituency: constituency,
    });
    if (!mp) {
      return res.status(404).json({ error: "MP not found" });
    }

    const receiver = mp.mp_mail;

    const { formId, formUrl } = await createGoogleForm(
      name,
      constituency,
      question
    );

    if (formId) {
      await QuestionResponseModel.create({
        mp_name: name,
        mp_constituency: constituency,
        formId,
        question,
      });
      formRegistry.set(formId, {
        created: new Date(),
        name,
        constituency,
        question,
        responded: false,
        email: receiver,
      });

      await MpModel.findOneAndUpdate(
        { mp_name: name, mp_constituency: constituency },
        {
          $inc: { QuestionsAsked: 1 },
          $addToSet: { formIds: formId },
        },
        { new: true }
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.user_mail,
        pass: process.env.app_password,
      },
    });

    const mailOptions = {
      from: process.env.user_mail,
      to: receiver,
      subject: "Question from a citizen",
      html: `
        <p>Dear ${name},</p>
        <p>You have received a new question from a citizen in ${constituency}:</p>
        <blockquote>${question}</blockquote>
        <p>Please respond using the link below:</p>
        <a href="${formUrl}">Click here to answer</a>
        <p>Regards,<br/>Citizen Connect Platform</p>
      `,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).json({ error: "Failed to send email" });
      }
      res.status(200).json({
        message: "Email sent successfully",
        formUrl,
        formId,
      });
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
export const updateAnalytics = async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ["https://www.googleapis.com/auth/forms.responses.readonly"],
    });

    const client = await auth.getClient();
    const forms = google.forms({ version: "v1", auth: client });
    const allMPs = await MpModel.find();
    for (const mp of allMPs) {
      let updatedFormIds = [];
      let countIncrement = 0;
      for (const formId of mp.formIds) {
        try {
          const res = await forms.forms.responses.list({ formId });
          const responses = res.data.responses || [];

          if (responses.length > 0) {
            const latestResponse = responses[responses.length - 1];

            const answerKeys = Object.keys(latestResponse.answers || {});
            const answerEntry =
              answerKeys.length > 0
                ? latestResponse.answers[answerKeys[0]]
                : null;

            const responseText =
              answerEntry?.textAnswers?.answers?.[0]?.value || "No answer";

            // Update if exists, otherwise create new
            await QuestionResponseModel.findOneAndUpdate(
              { formId },
              {
                mp_name: mp.mp_name,
                mp_constituency: mp.mp_constituency,
                email: mp.email,
                question: mp.question,
                response: responseText,
                responded: true,
                respondedAt: new Date(latestResponse.createTime),
              },
              { upsert: true, new: true } // Create if not exists
            );

            countIncrement += responses.length;
            // Do not keep this form ID anymore
          } else {
            updatedFormIds.push(formId);
          }
        } catch (err) {
          console.error(
            `Error fetching responses for formId ${formId}:`,
            err.message
          );
          updatedFormIds.push(formId);
        }
      }

      mp.formIds = updatedFormIds;
      mp.QuestionsAnswered = (mp.QuestionsAnswered || 0) + countIncrement;
      await mp.save();
    }

    res.status(200).json({ message: "Analytics updated and responses saved." });
  } catch (error) {
    console.error("Error updating analytics:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUpdatedResponses = async (req, res) => {
  try {
    // First update analytics and responses
    const fakeRes = {
      status: () => ({ json: () => { } }), // mock response object
    };

    await updateAnalytics(req, fakeRes);

    // Now fetch all the updated responses
    const responses = await QuestionResponseModel.find({}, {
      mp_name: 1,
      question: 1,
      response: 1,
      mp_constituency: 1,
      _id: 0, // optional: exclude _id from result
    });

    const formattedData = responses.map(r => ({
      mp_name: r.mp_name,
      question: r.question,
      response: r.response,
      constituency: r.mp_constituency,
    }));

    res.status(200).json({ data: formattedData });
  } catch (err) {
    console.error("Error fetching updated responses:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
