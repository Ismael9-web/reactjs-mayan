require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');

const app = express();
const port = 5000;

// Configure CORS to allow requests from the frontend
const corsOptions = {
    origin: 'http://localhost:3000', // Explicitly allow the frontend origin
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRFTOKEN'],
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Proxy route to handle login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const djangoAuthUrl = 'http://localhost/api/v4/auth/token/obtain/';
        // const csrfToken = 'HcHwo3XSuSrJFoUriTZaUzH4vHEFHn0oSMXbr5yuGgVlmzLGMfJ0yAQSUgMm6P9n'; // Replace with a dynamic token if needed

        const response = await axios.post(
            djangoAuthUrl,
            { username, password },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    // 'X-CSRFTOKEN': csrfToken,
                },
            }
        );
        console.log('response.data==>', response.data)
        console.log('response.body==>', response.body)
        res.json(response.data); // Forward the response from Django to the frontend
    } catch (error) {
        console.error('Error communicating with Django API:', error);

        if (error.response) {
            // Forward the error response from Django to the frontend
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ message: 'Internal server error.' });
        }
    }
});

// Function to get a token and session ID from Mayan EDMS
async function getMayanAuthToken() {
    const djangoAuthUrl = 'http://localhost/api/v4/auth/token/obtain/';

    try {
        // Replace hardcoded credentials with environment variables for better security
        const username = process.env.MAYAN_USERNAME;
        const password = process.env.MAYAN_PASSWORD;

        // Make the request to obtain the token and session ID
        const response = await axios.post(
            djangoAuthUrl,
            { username, password },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            }
        );

        // Extract the token and session ID dynamically from the response
        return {
            token: response.data.token, // Access the token from the response body
            sessionId: response.headers['set-cookie']?.[0]?.split(';')[0], // Extract session ID from the 'set-cookie' header
        };
    } catch (error) {
        console.error('Error fetching token from Mayan EDMS:', error);
        throw new Error('Failed to authenticate with Mayan EDMS.');
    }
}

// Middleware to include token and session ID in all requests to Mayan EDMS
async function mayanRequest(endpoint, method = 'GET', data = null) {
    const { token, sessionId } = await getMayanAuthToken();

    const url = `http://localhost/api/v4/${endpoint}`;

    try {
        const response = await axios({
            url,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cookie': sessionId,
                'Content-Type': 'application/json',
            },
            data,
        });

        return response.data;
    } catch (error) {
        console.error(`Error making request to Mayan EDMS (${method} ${url}):`, error);
        throw new Error('Failed to communicate with Mayan EDMS.');
    }
}

// Example route to fetch metadata from Mayan EDMS
app.get('/api/mayan/metadata', async (req, res) => {
    try {
        const metadata = await mayanRequest('metadata/');
        res.json(metadata);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a new route to fetch metadata
app.get('/api/fetch-metadata', (req, res) => {
    exec('./fetch_metadata.sh', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing script: ${error.message}`);
            return res.status(500).json({ error: 'Failed to fetch metadata.' });
        }
        if (stderr) {
            console.error(`Script stderr: ${stderr}`);
            return res.status(500).json({ error: 'Error in script execution.' });
        }

        // Parse the script output and send it as JSON
        const metadata = parseMetadata(stdout);
        res.json(metadata);
    });
});

// Add a new route to dynamically fetch the token and session ID
app.get('/api/mayan/auth', async (req, res) => {
    try {
        const { token, sessionId } = await getMayanAuthToken();
        res.json({ token, sessionId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route to fetch documents from Mayan API
app.get('/api/v4/workflow_templates/1/states/3/documents/', async (req, res) => {
    try {
        // Dynamically obtain CSRF token and session ID
        const { token, sessionId } = await getMayanAuthToken();

        console.log('Fetching documents from Mayan API...');
        console.log('CSRF Token:', token);
        console.log('Session ID:', sessionId);

        const response = await axios.get('http://localhost/api/v4/workflow_templates/1/states/3/documents/', {
            headers: {
                'accept': 'application/json',
                'X-CSRFTOKEN': token,
                // 'Cookie': `sessionid=${sessionId}`,
            },
        });

        console.log('Mayan API Response:', response.data);
        res.json(response.data); // Forward the response from Mayan API to the frontend
    } catch (error) {
        console.error('Error fetching documents from Mayan API:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to fetch documents from Mayan API.' });
    }
});

// Updated route to fetch documents from Mayan API
app.get('/api/documents', async (req, res) => {
    try {
        const token = req.cookies.authToken; // Retrieve token from cookies
        const sessionId = req.cookies.sessionId; // Retrieve session ID from cookies

        if (!token || !sessionId) {
            return res.status(401).json({ error: 'Unauthorized: Missing token or session ID.' });
        }

        const response = await axios.get('http://localhost/api/v4/workflow_templates/1/states/3/documents/', {
            headers: {
                'accept': 'application/json',
                'X-CSRFTOKEN': token,
                'Cookie': `sessionid=${sessionId}`,
            },
        });

        res.json(response.data); // Forward the response from Mayan API to the frontend
    } catch (error) {
        console.error('Error fetching documents from Mayan API:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to fetch documents from Mayan API.' });
    }
});

// Helper function to parse the script output
function parseMetadata(output) {
    const documents = [];
    const lines = output.split('\n');
    let currentDoc = null;

    lines.forEach((line) => {
        if (line.startsWith('----- Document ID:')) {
            if (currentDoc) {
                documents.push(currentDoc);
            }
            currentDoc = { id: line.split(':')[1].trim() };
        } else if (line.includes(':') && currentDoc) {
            const [key, value] = line.split(':').map((s) => s.trim());
            currentDoc[key] = value;
        }
    });

    if (currentDoc) {
        documents.push(currentDoc);
    }

    return documents;
}

// Start the Express server
app.listen(port, () => {
    console.log(`Backend server is running on http://localhost:${port}`);
});
