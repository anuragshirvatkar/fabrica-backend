# Fabrica Backend

B2B fabric marketplace API (Express + MongoDB + Firebase Auth).

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` and place your Firebase Admin SDK JSON at the path in `FIREBASE_SERVICE_ACCOUNT_PATH`.

```bash
npm run dev   # local with watch
npm start     # production
```

## Notes

- Do not commit `.env` or `*firebase-adminsdk*.json`
- Health check: `GET /health`
