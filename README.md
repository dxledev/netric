# Netric Sports

### an nba stats website

## Mongo storage

By default, auth/user data and player stats use the same MongoDB connection. For the EC2 deployment, point `MONGO_STATS_URI` at the local MongoDB instance and users will be stored there too.

- Local DB vars:
  - `MONGO_STATS_URI` (defaults to `mongodb://127.0.0.1:27017` when no primary Mongo URI is configured)
  - `MONGO_STATS_DB` (defaults to `netric_stats`)
- Optional auth override vars:
  - `MONGO_AUTH_URI` (defaults to `MONGO_STATS_URI`)
  - `MONGO_AUTH_DB` (defaults to `MONGO_STATS_DB`)
- Optional Atlas/primary vars for compatibility:
  - `MONGO_URI`, or `MONGO_USER` + `MONGO_PASS` + `MONGO_CLUSTER`

Example with an SSH tunnel to a Linux Mint machine:

```bash
ssh -N -L 27018:127.0.0.1:27017 youruser@mint-host
export MONGO_STATS_URI='mongodb://127.0.0.1:27018'
export MONGO_STATS_DB='netric_stats'
```

In this setup:
- `users` and `player_comments` use the local stats DB unless `MONGO_AUTH_URI` or `MONGO_AUTH_DB` are set
- `player_cache` and `fetch_queue` use the stats DB
