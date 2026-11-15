# OKayMaps

OKayMaps is a Boolean algebra and Karnaugh-map solving application.

## Live application

[Open OKayMaps](https://okaymaps.onrender.com/)

## Features

- Boolean expression simplification
- Truth-table solving
- Karnaugh-map visualization
- SOP, POS, and XOR/XNOR circuit representations
- Folded and unfolded MUX implementations
- Browser-based PDF export

## Requirements

- Python 3.10 or newer

## Run locally on Windows

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Then open http://localhost:8000.

You can also run `OKayMaps.bat` after installing the dependencies.

## OAuth sign-in configuration

The app supports GitHub and GitLab sign-in through the same-origin FastAPI backend. Configure these environment variables in Render:

```text
APP_BASE_URL=https://YOUR-RENDER-DOMAIN.onrender.com
SESSION_SECRET=<long-random-secret>
GITHUB_CLIENT_ID=<GitHub OAuth app client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth app client secret>
GITLAB_CLIENT_ID=<GitLab application client ID>
GITLAB_CLIENT_SECRET=<GitLab application client secret>
```

Register these callback URLs in the corresponding provider applications:

```text
https://YOUR-RENDER-DOMAIN.onrender.com/auth/github/callback
https://YOUR-RENDER-DOMAIN.onrender.com/auth/gitlab/callback
```

The OAuth secrets must be added only as Render environment variables and must not be committed to Git.

Works good
