# LexLiberia Backend API

Backend API for LexLiberia legal research platform built with Express.js, MongoDB, and Mongoose.

## Features

- User authentication (JWT)
- File upload (PDF/Word)
- Plan management
- Payment tracking
- Document management

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- Multer (file upload)
- bcryptjs
- jsonwebtoken

## Getting Started

### 1. Prerequisites

- Node.js (>=18.x)
- MongoDB (local or Atlas)

### 2. Installation

```bash
cd backend
npm install
```

### 3. Environment Variables

Create a `.env` file in the backend directory and add your configuration (use `.env.example` as a template).

### 4. Seed Database

To create the initial plans in the database:

```bash
npm run seed
```

### 5. Run the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Auth Routes
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user (protected)

### Plan Routes
- `GET /api/plans` - Get all plans
- `GET /api/plans/:id` - Get single plan
- `POST /api/plans` - Create plan (admin only)
- `PUT /api/plans/:id` - Update plan (admin only)
- `DELETE /api/plans/:id` - Delete plan (admin only)

### Document Routes
- `GET /api/documents` - Get all documents
- `GET /api/documents/:id` - Get single document
- `POST /api/documents` - Upload document (admin only)
- `PUT /api/documents/:id` - Update document (admin only)
- `DELETE /api/documents/:id` - Delete document (admin only)
- `GET /api/documents/download/:id` - Download document (protected)

### Payment Routes
- `GET /api/payments` - Get user payments (protected)
- `POST /api/payments` - Create payment (protected)
- `GET /api/payments/:id` - Get single payment (protected)

## Deployment on Render

1. Push your code to a GitHub repository
2. Create a new Web Service on Render
3. Connect your repository
4. Set the build command to `npm install`
5. Set the start command to `npm start`
6. Add environment variables in Render dashboard:
   - `MONGODB_URI` (use MongoDB Atlas for production)
   - `JWT_SECRET` (strong secret key)
   - `NODE_ENV` = `production`
   - `CLIENT_URL` (your frontend URL)
7. Deploy!

## License

ISC
