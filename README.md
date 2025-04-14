# ReactJS Mayan

ReactJS Mayan est une application web basée sur React qui inclut l'authentification, le routage et un tableau de bord. Elle utilise des bibliothèques modernes comme `react-router-dom`, `axios` et `tailwindcss` pour le style.

## Fonctionnalités

- Authentification utilisateur (connexion/déconnexion) via une API basée sur des jetons.
- Routes protégées pour les utilisateurs authentifiés.
- Page de tableau de bord accessible uniquement après connexion.
- TailwindCSS pour un design moderne et réactif.

## Prérequis

- Node.js (v18 ou supérieur)
- npm (v8 ou supérieur)

## Installation

1. Clonez le dépôt :
   ```bash
   git clone <repository-url>
   cd reactjs-mayan
   ```

2. Installez les dépendances :
   ```bash
   npm install
   ```

3. Lancez le serveur de développement :
   ```bash
   npm start
   ```

4. Ouvrez votre navigateur et accédez à `http://localhost:3000`.

## Structure du Projet

```
reactjs-mayan/
├── src/
│   ├── components/
│   │   ├── Auth/
│   │   │   └── LoginPage.jsx
│   │   ├── Dashboard/
│   │   │   └── DashboardPage.jsx
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── App.jsx
│   ├── index.js
│   └── App.css
├── package.json
└── README.md
```

## Fichiers Clés

- **`src/context/AuthContext.jsx`** : Gère l'état d'authentification et fournit les fonctionnalités de connexion/déconnexion.
- **`src/App.jsx`** : Définit les routes et inclut un composant `PrivateRoute` pour les pages protégées.
- **`src/components/Auth/LoginPage.jsx`** : Formulaire de connexion pour l'authentification utilisateur.
- **`src/components/Dashboard/DashboardPage.jsx`** : Page de tableau de bord accessible uniquement aux utilisateurs authentifiés.

## Scripts

- `npm start` : Démarre le serveur de développement.
- `npm build` : Construit l'application pour la production.
- `npm test` : Exécute les tests.
- `npm eject` : Extrait la configuration de l'application.

## Intégration API

L'application utilise une API pour l'authentification. Mettez à jour l'URL de l'API dans `src/context/AuthContext.jsx` si nécessaire :
```javascript
const response = await api.post('http://localhost/api/v4/auth/token/obtain/', {
  username,
  password,
});
```

## Style

Le projet utilise TailwindCSS pour le style. Assurez-vous de la compatibilité en utilisant la version `postcss7-compat` de TailwindCSS.

## Licence

Ce projet est sous licence MIT. Consultez le fichier `LICENSE` pour plus de détails.
