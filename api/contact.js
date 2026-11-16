const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // 1. Extract the new 'service' field along with the rest
    const { name, email, phone, service, message } = req.body;

    try {
        // Connect to MongoDB Atlas
        // Vercel will securely store your MONGODB_URI
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        // Replace 'vertex_db' with your actual database name if different
        const db = client.db('vertex_db'); 
        const collection = db.collection('leads');

        // 2. Save the Lead and the chosen Service to the Database
        await collection.insertOne({
            name,
            email,
            phone,
            service, // <--- Saves to the database here
            message,
            date: new Date()
        });
        await client.close();

        // Send the Email Alert directly to you
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Assuming you use Gmail/Google Workspace
            auth: {
                user: process.env.EMAIL_USER, // e.g., info@vertexnextgen.com.ng
                pass: process.env.EMAIL_PASS  // Your App Password
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER, // Your personal Gmail (the engine)
            to: 'info@vertexnextgen.com.ng', // Your business email (the destination)
            replyTo: email, // The client's email (so you can hit "reply" easily)
            subject: `New System Lead: ${name}`,
            // 3. Inject the Service into the email body
            text: `You have a new consultation request from the Vertex website!\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nInterest: ${service}\n\nMessage:\n${message}`
        };

        await transporter.sendMail(mailOptions);

        // Send Success Response back to the website
        res.status(200).json({ success: true, message: 'Message sent successfully.' });

    } catch (error) {
        console.error('Backend Error:', error);
        res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
    }
};