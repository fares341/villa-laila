# Auto-deploy (GitHub → server)

Every push to `main` makes GitHub Actions SSH into the server and run `scripts/deploy.sh`:
pull latest code → `docker compose up -d --build` → wait for `/api/health`.
The database volume, `.env` and `backups/` are never touched.

## One-time setup on the server
```bash
# 1) project folder on the server (skip if it's already there)
sudo mkdir -p /opt/villa-laila && sudo chown $USER /opt/villa-laila
git clone https://github.com/fares341/villa-laila /opt/villa-laila   # private repo: use a deploy key, see below
cd /opt/villa-laila && cp .env.example .env && nano .env

# 2) SSH key that GitHub Actions will use to log in
ssh-keygen -t ed25519 -f ~/.ssh/gh_deploy -N "" -C "github-actions"
cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/gh_deploy        # copy this PRIVATE key into the SSH_KEY secret

# 3) first deploy by hand
bash scripts/deploy.sh
```

Private repo? Let the server pull with a read-only deploy key:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/repo_key -N ""
cat ~/.ssh/repo_key.pub     # GitHub → repo Settings → Deploy keys → Add (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/repo_key\n' >> ~/.ssh/config
git -C /opt/villa-laila remote set-url origin git@github.com:fares341/villa-laila.git
```

## GitHub secrets (repo → Settings → Secrets and variables → Actions)
| Secret | Value |
|---|---|
| `SSH_HOST` | server IP, e.g. `168.231.81.69` |
| `SSH_USER` | the user that owns `/opt/villa-laila` and can run `docker` |
| `SSH_KEY` | contents of `~/.ssh/gh_deploy` (private key) |
| `SSH_PORT` | optional, default `22` |
| `APP_DIR` | optional, default `/opt/villa-laila` |

The user must be able to run docker without sudo: `sudo usermod -aG docker $USER` then log out and back in.

## Deploy manually
- From GitHub: Actions → **Deploy to server** → Run workflow.
- On the server: `bash /opt/villa-laila/scripts/deploy.sh`
