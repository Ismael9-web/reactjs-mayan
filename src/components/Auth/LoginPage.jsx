import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import logo from '../../assets/logo.png';
import Cookies from 'js-cookie';

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        try {
            const response = await api.post('/login', { username, password });

            if (response.data.token) {
                Cookies.set('authToken', response.data.token, { expires: 1 });
                navigate('/dashboard');
            } else {
                setError('Échec de la connexion. Veuillez vérifier vos identifiants.');
            }
        } catch (error) {
            console.error('Une erreur s\'est produite lors de la connexion :', error);
            setError('Une erreur inattendue s\'est produite. Veuillez réessayer plus tard.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="flex flex-col md:flex-row w-full max-w-4xl bg-white shadow-lg rounded-lg overflow-hidden">
                <div className="md:w-1/2 flex flex-col justify-center p-8">
                    <div className="mb-6">
                        <img src={logo} alt="Logo" className="h-12" />
                    </div>
                    <h2 className="text-2xl font-bold mb-4">Welcome Back</h2>
                    <p className="text-gray-600 mb-6">Login to your account to continue</p>
                    {error && <p className="text-red-500 text-center mb-4">{error}</p>}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700">Email</label>
                            <input
                                type="text"
                                id="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                placeholder="m@example.com"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                placeholder="Enter your password"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="text-right mt-1">
                                <a href="#" className="text-sm text-blue-500 hover:underline">Forgot your password?</a>
                            </div>
                        </div>
                        <button
                            type="submit"
                            className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600"
                        >
                            Login
                        </button>
                    </form>
                    <div className="flex items-center my-6">
                        <div className="flex-grow border-t border-gray-300"></div>
                        <span className="mx-2 text-gray-500">or</span>
                        <div className="flex-grow border-t border-gray-300"></div>
                    </div>
                    <button
                        className="w-full flex items-center justify-center border border-gray-300 py-2 px-4 rounded-lg hover:bg-gray-100"
                    >
                        <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.48 2 2 6.48 2 12c0 4.84 3.87 8.8 8.65 9.74.63.12.86-.27.86-.6v-2.17c-3.52.77-4.26-1.7-4.26-1.7-.57-1.45-1.4-1.84-1.4-1.84-1.15-.79.09-.77.09-.77 1.27.09 1.94 1.31 1.94 1.31 1.13 1.94 2.96 1.38 3.68 1.05.11-.82.44-1.38.8-1.7-2.81-.32-5.77-1.41-5.77-6.27 0-1.38.5-2.5 1.31-3.38-.13-.32-.57-1.62.12-3.38 0 0 1.06-.34 3.48 1.3a12.1 12.1 0 013.18-.43c1.08 0 2.16.15 3.18.43 2.42-1.64 3.48-1.3 3.48-1.3.69 1.76.25 3.06.12 3.38.81.88 1.31 2 1.31 3.38 0 4.87-2.96 5.95-5.78 6.27.45.39.85 1.16.85 2.34v3.48c0 .33.23.72.87.6C18.13 20.8 22 16.84 22 12c0-5.52-4.48-10-10-10z" />
                        </svg>
                        Login with GitHub
                    </button>
                </div>
                <div className="hidden md:flex md:w-1/2 bg-blue-500 items-center justify-center">
                    <div className="text-white text-center px-8">
                        <h3 className="text-3xl font-bold mb-4">Welcome Back!</h3>
                        <p className="text-lg">To keep connected with us, please login with your personal info</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;