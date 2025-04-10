import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        const success = await login(username, password);
        if (success) {
          navigate('/dashboard');
        } else {
          alert('Échec de la connexion. Veuillez vérifier vos identifiants.');
        }
      };

      return (
        <div>
          <h2>Connexion</h2>
          <form onSubmit={handleSubmit}>
            <div>
              <label htmlFor="username">Nom d'utilisateur :</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="password">Mot de passe :</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit">Se connecter</button>
          </form>
        </div>
      );
    };

export default LoginPage;