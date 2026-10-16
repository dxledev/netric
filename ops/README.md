# Local production deployment

This deployment serves the Vite build from Nginx, proxies `/api/` to FastAPI on
`127.0.0.1:8000`, keeps the backend alive with systemd, enables the existing NBA
refresh timer, and checks the complete stack every minute. The health monitor
starts stopped services and restarts services whose HTTP checks fail.

## Initial installation

Run this from the repository as the normal desktop user:

```bash
./ops/deploy-local.sh netricsports.us
```

The frontend and Python checks run before the script asks for the local sudo
password. Use this installer for the initial setup: it replaces the Nginx site
configuration and web root.

For subsequent releases, run:

```bash
./rebuild.sh netricsports.us
```

This preserves existing TLS and custom Nginx configuration, retains older hashed
assets for open tabs, and makes HTML and the build manifest revalidate on every
request. The frontend checks for new releases when returning to a tab and every
minute while visible, then updates automatically when there is no unsaved text.
Tabs opened before the update checker was installed need one initial reload to
acquire it.

## Turn the site on and off

The installer adds a `netricctl` command:

```bash
netricctl status
sudo netricctl off
sudo netricctl on
sudo netricctl toggle
sudo netricctl restart
sudo netricctl logs
```

`on` starts the stack and enables it at boot. `off` stops Nginx, FastAPI, and
both Netric timers and disables them at boot, so the health monitor will not
turn the site back on. MongoDB is deliberately left running because it may be
used by other local processes. The backend has `Restart=always`, and the
one-minute health timer also recovers backend, Nginx, or MongoDB failures while
Netric is enabled.

## Home-network and DNS setup

1. Give this computer a DHCP reservation in the router so its LAN address does
   not change.
2. Forward TCP port 80 and TCP port 443 from the router to this computer.
3. Set the domain's root (`@`) `A` record to the public IPv4 address. Set `www`
   to a `CNAME` pointing at the root domain, or use the same `A` record.
4. Use a low DNS TTL while testing. A residential public IP can change, so set
   up dynamic DNS or update the record whenever it changes.
5. Confirm that the router's WAN address matches the detected public address.
   If it is private or in `100.64.0.0/10`, ask the ISP for a public IPv4 address
   or use a tunnel service because normal port forwarding will not work.

Test the site from a phone with Wi-Fi disabled; many routers do not support
accessing their own public IP from inside the home network.

## HTTPS after DNS works

Once the domain resolves to this host and inbound port 80 works:

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d netricsports.us -d www.netricsports.us
```

Only include the `www` name after its DNS record exists. Certbot updates the
Nginx site and installs automatic certificate renewal.

## Service checks

```bash
systemctl status netric-backend nginx mongod
systemctl status netric-nightly-refresh.timer
systemctl status netric-healthcheck.timer
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/api/openapi.json
```
