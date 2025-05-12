require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const app = express();
const port = 5000;

// Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Helper function to fetch token
async function getAuthToken() {
    try {
        const response = await axios.post('http://localhost/api/v4/auth/token/obtain/', {
            username: process.env.MAYAN_USERNAME,
            password: process.env.MAYAN_PASSWORD,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        return response.data.token;
    } catch (error) {
        console.error('Error fetching auth token:', error);
        throw new Error('Failed to fetch auth token');
    }
}

// Route to handle login requests
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const response = await axios.post('http://localhost/api/v4/auth/token/obtain/', {
            username,
            password,
        }, {
            headers: { 'Content-Type': 'application/json' },
        });

        const token = response.data.token;

        // Send token and optionally set a cookie
        res
            .cookie('authToken', token, {
                httpOnly: false, // client-side access
                secure: false,   // use true in production with HTTPS
                sameSite: 'Lax',
                maxAge: 24 * 60 * 60 * 1000, // 1 day
            })
            .json({ token });

    } catch (error) {
        console.error('Login error:', error.message);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Route to fetch documents with optional filters
app.get('/api/documents', async (req, res) => {
    try {
        const token = await getAuthToken();
        const response = await axios.get('http://localhost/api/v4/workflow_templates/1/states/3/documents/', {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        let documents = response.data.results;

        // Apply filters if provided
        const { keyword, startDate, endDate, status } = req.query;
        if (keyword) {
            documents = documents.filter(doc => doc.metadata.some(meta => meta.value.includes(keyword)));
        }
        if (startDate) {
            documents = documents.filter(doc => new Date(doc.date_created) >= new Date(startDate));
        }
        if (endDate) {
            documents = documents.filter(doc => new Date(doc.date_created) <= new Date(endDate));
        }
        if (status) {
            documents = documents.filter(doc => doc.status === status);
        }

        res.json(documents);
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
