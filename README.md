Visitor Monitoring API

This is a small Node/Express API for visitor monitoring.

How to push this project to GitHub (from this machine):

1. Initialize git (if not already):

   git init

2. Set a local git user (optional):

   git config user.email "you@example.com"
   git config user.name "Your Name"

3. Add files and commit:

   git add -A
   git commit -m "Initial commit"

4. Add the remote and push:

   git remote add origin https://github.com/jfks18/visitorApi.git
   git branch -M main
   git push -u origin main

If pushing from CI or a different machine, use a personal access token for HTTPS or add an SSH remote.

# Visitor Monitoring API

## Email (Gmail SMTP)

This API can send emails using SMTP via Gmail. For Gmail, use a Gmail App Password (not your normal password).

1) Create `.env` from `.env.example` and fill in values:

Required for Gmail:
- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=465
- SMTP_SECURE=true
- SMTP_USER=your.gmail.address@gmail.com
- SMTP_PASS=your_16_char_app_password  (paste without spaces)
- SMTP_FROM=Visitor Monitoring <your.gmail.address@gmail.com>  (optional)

How to get a Gmail App Password:
- Enable 2‑Step Verification in your Google Account.
- Go to Security → App passwords → Generate new.
- Choose App: Mail, Device: Other → Generate.
- Copy the 16-letter code and paste it into SMTP_PASS (remove spaces).

## Test the email endpoint

POST /api/email/send
Body:
{
   "to": "recipient@example.com",
   "subject": "Gmail test",
   "text": "Hello from Gmail SMTP"
}

Response includes messageId/accepted/rejected/response when successful.

Note: Do not commit your real `.env`. A `.gitignore` entry is recommended.
