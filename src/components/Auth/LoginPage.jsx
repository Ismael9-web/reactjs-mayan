import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import logo from '../../assets/logo.png';
import Cookies from 'js-cookie';
import './LoginPage.css';

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        try {
            const response = await api.post('/login', { username, password }); // Ensure the backend handles this route

            if (response.data.token) {
                Cookies.set('authToken', response.data.token, { expires: 1 });
                navigate('/dashboard');
            } else {
                setError('Login failed. Please check your credentials.');
            }
        } catch (error) {
            console.error('An error occurred during login:', error);
            setError('An unexpected error occurred. Please try again later.');
        }
    };

    return (
        <div className="login-container">
            <img src={logo} alt="Logo" className="login-logo" />
            <h2 className="login-title">Connexion</h2>
            {error && <p className="login-error">{error}</p>}
            <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                    <label htmlFor="username">Nom d'utilisateur :</label>
                    <input
                        type="text"
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        className="form-input"
                        placeholder="Enter your username"
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="password">Mot de passe :</label>
                    <input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="form-input"
                        placeholder="Enter your password"
                    />
                </div>
                <button type="submit" className="login-button">
                    Se connecter
                </button>
            </form>
            <footer className="login-footer">
                © 2025 Ministère du Budget - Direction des Systèmes d'Information
            </footer>
        </div>
    );
};

export default LoginPage;