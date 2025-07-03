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

app.use((req, res, next) => {
    const csrfToken = req.cookies.csrftoken;
    const sessionId = req.cookies.sessionid;
    const authToken = req.cookies.authToken;

    if (csrfToken && sessionId && authToken) {
        req.headers['X-CSRFTOKEN'] = csrfToken;
        req.headers['Cookie'] = `sessionid=${sessionId}`;
        req.headers['Authorization'] = `Bearer ${authToken}`;
    }

    next();
});

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
        console.log('Auth token fetched successfully:', response.data.token); // Debugging log
        return response.data.token;
    } catch (error) {
        console.error('Error fetching auth token:', error.response ? error.response.data : error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw new Error('Failed to fetch auth token');
    }
}

// Helper function to verify workflow template and state
async function verifyWorkflowTemplateAndState(token, templateId, stateId) {
    try {
        const response = await axios.get(`http://localhost/api/v4/workflow_templates/${templateId}/`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const states = response.data.states;
        const stateExists = states.some((state) => state.id === stateId);

        if (!stateExists) {
            throw new Error(`State ID ${stateId} does not exist in Workflow Template ID ${templateId}`);
        }
    } catch (error) {
        console.error('Error verifying workflow template and state:', error.response ? error.response.data : error.message);
        throw new Error('Invalid Workflow Template or State');
    }
}

// Route to handle login requests
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Only get token, do not require CSRF/session for login
        const tokenResponse = await axios.post('http://localhost/api/v4/auth/token/obtain/', {
            username,
            password,
        }, { headers: { 'Content-Type': 'application/json' } });
        const token = tokenResponse.data.token;

        // Set token as cookie for client
        res
            .cookie('authToken', token, { httpOnly: false, secure: false, sameSite: 'Lax', maxAge: 24 * 60 * 60 * 1000 })
            .json({ token });

    } catch (error) {
        console.error('Login error:', error.message);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Route to fetch documents with optional filters
app.get('/api/documents', async (req, res) => {
    try {
        console.log('Fetching documents from Mayan API..');
        console.log('Cookies received:', req.cookies); // Debugging log to check cookies

        const token = await getAuthToken();
        if (!token) {
            console.error('Error: Auth token is null or undefined');
            return res.status(500).json({ error: 'Failed to fetch auth token' });
        }

        const csrfToken = req.cookies.csrftoken; // Retrieve CSRF token from cookies
        const sessionId = req.cookies.sessionid; // Retrieve session ID from cookies

        if (!csrfToken || !sessionId) {
            console.error('Error: Missing CSRF token or session ID');
            return res.status(400).json({ error: 'Missing CSRF token or session ID' });
        }

        const apiUrl = 'http://localhost/api/v4/workflow_templates/1/states/3/documents/';
        console.log('API URL:', apiUrl);

        const response = await axios.get(apiUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRFTOKEN': csrfToken,
                Cookie: `sessionid=${sessionId}`,
                Accept: 'application/json',
            },
        });

        if (!response.data || !response.data.results) {
            console.error('Error: Invalid response from Mayan API');
            return res.status(500).json({ error: 'Invalid response from Mayan API' });
        }

        console.log('Documents fetched successfully:', response.data.results);
        res.json(response.data.results);
    } catch (error) {
        console.error('Error fetching documents:', error.response ? error.response.data : error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        res.status(500).json({ error: error.message || 'Failed to fetch documents' });
    }
});

app.get('/api/documents_with_metadata', async (req, res) => {
    try {
        console.log('Fetching documents and metadata from Mayan API...');
        const token = await getAuthToken();
        if (!token) {
            console.error('Error: Auth token is null or undefined');
            return res.status(500).json({ error: 'Failed to fetch auth token' });
        }
        console.log('Auth token:', token); // Debugging log
        const csrfToken = req.cookies.csrftoken; // Retrieve CSRF token from cookies
        const sessionId = req.cookies.sessionid; // Retrieve session ID from cookies

        if (!csrfToken || !sessionId) {
            console.error('Error: Missing CSRF token or session ID');
            return res.status(400).json({ error: 'Missing CSRF token or session ID' });
        }

        const apiUrl = 'http://localhost/api/v4/workflow_templates/1/states/3/documents/';
        console.log('API URL:', apiUrl);

        const documentsResponse = await axios.get(apiUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRFTOKEN': csrfToken,
                Cookie: `sessionid=${sessionId}`,
                Accept: 'application/json',
            },
        });

        if (!documentsResponse.data || !documentsResponse.data.results) {
            console.error('Error: Invalid response from Mayan API');
            return res.status(500).json({ error: 'Invalid response from Mayan API' });
        }

        const documents = documentsResponse.data.results;

        // Fetch metadata for each document
        const documentsWithMetadata = await Promise.all(
            documents.map(async (doc) => {
                try {
                    const metadataResponse = await axios.get(`http://localhost/api/v4/documents/${doc.id}/metadata/`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-CSRFTOKEN': csrfToken,
                            Cookie: `sessionid=${sessionId}`,
                            Accept: 'application/json',
                        },
                    });

                    return {
                        ...doc,
                        metadata: metadataResponse.data.results || [],
                    };
                } catch (error) {
                    console.error(`Error fetching metadata for document ID ${doc.id}:`, error.response ? error.response.data : error.message);
                    return {
                        ...doc,
                        metadata: [],
                    };
                }
            })
        );

        console.log('Documents with metadata fetched successfully:', documentsWithMetadata);
        res.json(documentsWithMetadata);
    } catch (error) {
        console.error('Error fetching documents and metadata:', error.response ? error.response.data : error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        res.status(500).json({ error: error.message || 'Failed to fetch documents and metadata' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('csrftoken');
    res.clearCookie('sessionid');
    res.clearCookie('authToken');
    res.status(200).json({ message: 'Logged out successfully' });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
