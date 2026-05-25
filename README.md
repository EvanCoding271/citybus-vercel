# 🚌 CityBus Transport — Vercel + Supabase Deployment Guide

---

## 📁 Project Structure

```
citybus-vercel/
├── api/
│   └── index.py          ← FastAPI backend (Vercel serverless function)
├── public/
│   ├── index.html        ← Frontend SPA
│   ├── styles.css        ← All styles + dark/light theme
│   └── app.js            ← All JavaScript (API calls, QR, DOM)
├── vercel.json           ← Vercel routing config
├── requirements.txt      ← Python dependencies
└── README.md
```

---

## 🗄️ PART 1 — Set Up Supabase (Database)

### Step 1 — Create a Supabase Account
1. Go to **https://supabase.com**
2. Click **Start your project** → Sign up with GitHub or Email
3. Verify your email if prompted

### Step 2 — Create a New Project
1. Click **New Project**
2. Fill in:
   - **Organization** → your name or org
   - **Project Name** → `citybus`
   - **Database Password** → create a strong password (save this!)
   - **Region** → pick the closest to Philippines (Singapore)
3. Click **Create new project** — wait ~2 minutes for it to spin up

### Step 3 — Run the Database Schema
1. In your project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Copy the entire contents of `schema.sql` (provided separately) and paste it in
4. Click **Run** (green button, top right)
5. You should see "Success. No rows returned" — that means it worked ✅

### Step 4 — Get Your Database Connection String
1. In the left sidebar, go to **Project Settings** → **Database**
2. Scroll down to **Connection string**
3. Select the **URI** tab
4. Copy the string — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the password you set in Step 2
6. **Save this string** — you'll need it for Vercel

---

## 🐙 PART 2 — Push Your Code to GitHub

### Step 5 — Create a GitHub Account (if you don't have one)
1. Go to **https://github.com** → Sign up

### Step 6 — Create a New Repository
1. Click the **+** icon (top right) → **New repository**
2. Name it `citybus`
3. Set to **Private** (recommended)
4. Click **Create repository**
5. GitHub will show you setup instructions — keep this page open

### Step 7 — Upload Your Project Files
**Option A — Using GitHub website (easiest):**
1. On your new repo page, click **uploading an existing file**
2. Drag and drop ALL the files from the `citybus-vercel` folder
   - Make sure to maintain the folder structure:
     - `api/index.py`
     - `public/index.html`
     - `public/styles.css`
     - `public/app.js`
     - `vercel.json`
     - `requirements.txt`
3. Click **Commit changes**

**Option B — Using Git (if you have it installed):**
```bash
cd citybus-vercel
git init
git add .
git commit -m "Initial CityBus commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/citybus.git
git push -u origin main
```

---

## 🔺 PART 3 — Deploy to Vercel

### Step 8 — Create a Vercel Account
1. Go to **https://vercel.com**
2. Click **Sign Up** → choose **Continue with GitHub**
3. Authorize Vercel to access your GitHub account

### Step 9 — Import Your GitHub Repository
1. On the Vercel dashboard, click **Add New…** → **Project**
2. You'll see a list of your GitHub repos
3. Find `citybus` and click **Import**

### Step 10 — Configure the Project
On the configuration screen:
1. **Framework Preset** → leave as **Other**
2. **Root Directory** → leave as `/` (the default)
3. **Build & Output Settings** → leave everything blank/default
4. **Environment Variables** → this is the important part ⬇️

### Step 11 — Add Environment Variables
Still on the Vercel import screen, scroll to **Environment Variables**:

Click **Add** for each of these:

| Name | Value |
|------|-------|
| `DATABASE_URL` | your Supabase connection string from Step 4 |
| `JWT_SECRET` | any random string like `citybus-prod-secret-key-2026` |

To add each one:
1. Click **+ Add**
2. Type the **Name** in the left box
3. Paste the **Value** in the right box
4. Click the checkmark ✓

### Step 12 — Deploy!
1. Click **Deploy**
2. Watch the build logs — it should take about 60–90 seconds
3. When it says **"Congratulations! Your project has been successfully deployed"** you're done! 🎉
4. Click **Visit** to open your live site

Your URL will look like: `https://citybus-xxxxxxxxx.vercel.app`

---

## 🔑 Default Login Accounts (pre-seeded)

| Role     | Email                  | Password     |
|----------|------------------------|--------------|
| Passenger| juan@example.com       | password123  |
| Admin    | admin@citybus.com      | admin123     |
| Finance  | finance@citybus.com    | finance123   |
| Operator | operator@citybus.com   | operator123  |

> The database seeds these automatically on the first API call.

---

## 🔧 Making Future Code Changes

After your first deploy, to update the site:

1. Edit your files locally
2. Go to your GitHub repo
3. Click on the file you want to update → click the pencil ✏️ icon → paste new code → click **Commit changes**
4. Vercel automatically detects the GitHub push and re-deploys within ~60 seconds

---

## 🆘 Troubleshooting

**"Application error" or blank page?**
→ Go to Vercel Dashboard → your project → **Deployments** → click the latest → **Functions** → check the logs

**"Connection refused" or database errors?**
→ Double-check your `DATABASE_URL` in Vercel. Go to Vercel → Settings → Environment Variables → verify it's correct

**"Table doesn't exist" error?**
→ You need to run the SQL schema in Supabase. Go back to Part 1, Step 3.

**Supabase password issues?**
→ In Supabase, go to Project Settings → Database → click **Reset database password** and use the new one in your Vercel env var

**API returning 401 errors after login?**
→ Make sure your `JWT_SECRET` environment variable is set in Vercel and re-deploy

---

## 🌐 API Documentation

Once deployed, visit:
- `https://your-app.vercel.app/api/docs` — Swagger UI
- `https://your-app.vercel.app/api/health` — Health check
