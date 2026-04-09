# Netric Sports

### an nba stats website

## Mongo split storage

You can keep auth/user data on Atlas and store player stats on a second MongoDB.

- Required existing vars for primary DB: `MONGO_USER`, `MONGO_PASS`, `MONGO_CLUSTER`
- Optional stats DB vars:
  - `MONGO_STATS_URI` (defaults to primary URI when unset)
  - `MONGO_STATS_DB` (defaults to `netric_stats`)

Example with an SSH tunnel to a Linux Mint machine:

```bash
ssh -N -L 27018:127.0.0.1:27017 youruser@mint-host
export MONGO_STATS_URI='mongodb://127.0.0.1:27018'
export MONGO_STATS_DB='netric_stats'
```

In this setup:
- `users` stays on the primary Atlas DB
- `player_cache` and `fetch_queue` use the stats DB
