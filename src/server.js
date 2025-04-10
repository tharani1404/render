import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import userRoutes from "./routes/users.route.js";
import chatRoutes from "./routes/chat.route.js";
import productRoutes from "./routes/products.route.js";
import askyournetaRoutes from "./routes/askyourneta.route.js";
import newsRoutes from "./routes/news.route.js";
import axios from 'axios'; // Import axios

import { Server } from "socket.io";
import http from "http";
import cors from 'cors';
// import { spawn } from 'child_process'; // Remove spawn import

// function startPythonScript() { // Remove the function
//     const pythonProcess = spawn('python', ['script2.py']); // Adjust the path if needed

//     // Listen for output from the Python script
//     pythonProcess.stdout.on('data', (data) => {
//         console.log(`Python stdout: ${data}`);
//     });

//     // Listen for errors
//     pythonProcess.stderr.on('data', (data) => {
//         console.error(`Python stderr: ${data}`);
//     });

//     // Handle script exit
//     pythonProcess.on('close', (code) => {
//         console.log(`Python script exited with code ${code}`);
//     });

//     // Handle backend exit and ensure cleanup
//     process.on('exit', () => {
//         console.log('Backend shutting down, killing Python script...');
//         pythonProcess.kill(); // Kill the Python process
//     });

//     return pythonProcess;
// }

// Start the Python script when backend starts
// const pythonProcess = startPythonScript(); // Remove the call

dotenv.config();
const app = express();
app.use(cors());

// ✅ Increased limit for JSON and URL-encoded data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configuration (Moved to top for clarity)
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001'; // Or the actual URL of your Python service
const PORT = process.env.PORT || 5000; //Added to define port

app.use("/api", userRoutes);
app.use("/api", chatRoutes);
app.use("/api", productRoutes);
app.use("/api", askyournetaRoutes);
app.use("/api", newsRoutes);

// Modified newsRoutes to incorporate caching
app.post('/api/news/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`Searching for news: ${query}`);

    // Call Python service
    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/search`, {
        query: query
      }, {
        timeout: 30000 // 30 second timeout
      });

      res.json(response.data); // Forward the data from Python service
    } catch (pythonError) {
      console.error('Error calling Python service:', pythonError.message);

      if (pythonError.response) {
        return res.status(pythonError.response.status).json({
          error: `Python service error: ${pythonError.response.data.error || 'Unknown error'}`
        });
      }

      return res.status(500).json({ error: 'Python service unavailable' });
    }
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search service unavailable' });
  }
});


const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinRoom", (conversationId) => {
        socket.join(conversationId);
    });

    socket.on("sendMessage", async (data) => {
        const { conversation_id, sender_id, message_text, message_type } = data;
        // const message = new Message({ conversation_id, sender_id, message_text, message_type });

        // await message.save();
        // await Conversation.findByIdAndUpdate(conversation_id, { last_message_at: new Date() });

        io.to(conversation_id).emit("newMessage", data);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});



server.listen(PORT, () => {
    connectDB();
    console.log(`Server started at http://localhost:${PORT}`);
});