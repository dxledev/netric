# Netric Sports

Netric Sports is an NBA stats web app for searching players and teams, tracking favorites, comparing seasons, and following player discussion.

Live site: [netricsports.us](https://netricsports.us)

### Favorites Dashboard

- View saved players, teams, and stat categories in one dashboard.
- See quick counts for favorite players, teams, and stats.
- Switch between favorite player, team, and stat tabs.
- Open Search, Compare, Standings, and Profile from dashboard actions.
- Reorder favorite players and teams with drag-and-drop.
- Move favorite players or teams back to the top of the dashboard.
- Remove favorited players and teams from saved lists.
- Filter favorite players by player name and team.
- Sort favorite players by PTS, AST, REB, STL, BLK, TOV, MIN, FG%, 3FG%, FT%, TS%, or eFG%.
- Choose ascending or descending sort direction.

### Search

- Search across players, teams, and stat categories.
- Use live player match suggestions while typing.
- Search teams by name, city, nickname, or abbreviation.
- View player result cards with headshot, season averages, shooting stats, efficiency, and recent game context.
- Favorite or unfavorite players from search results.
- Favorite or unfavorite teams from team result cards.
- Open a detailed player or team page directly from search results.
- Browse trending players based on recent player discussion.

### Player Pages

- View a player overview with headshot, team, season, games played, and key stat cards.
- Favorite or unfavorite a player from their profile.
- Switch between Season, Game Logs, Game Highs, Advanced, and Comments tabs.
- Toggle regular-season and postseason views where available.
- Change the active season to compare year-over-year performance.
- Review per-game production, shot-making, efficiency, and availability stats.
- View last game and last five games from the selected scope.
- Open a single-game summary from recent games or game logs.
- Browse full game-log tables with scoring, rebounding, passing, defensive, shooting, turnover, foul, and plus-minus columns.
- Group game logs by default view, month, or week.
- Sort postseason game logs by date direction.
- See game-log averages for grouped regular-season logs.
- Review single-game highs by category.
- Filter game highs by all-time or a specific season.
- Open top-50 stat-high pages for PTS, REB, AST, STL, BLK, FGM, 3PM, FTM, TOV, MIN, or plus-minus.
- Open detailed single-game summaries with box-score, shooting, efficiency, matchup, date, result, and quick-read sections.

### Player Comparison

- Select two players for side-by-side comparison.
- Search and choose players in each comparison slot.
- Compare each player by selected season.
- Compare regular season, playoffs, and play-in scopes.
- See warnings when a selected player has no data for the chosen season or scope.
- Review matching stat rows side by side.

### Teams

- Browse all NBA teams.
- Search teams by name, city, nickname, or abbreviation.
- Open team detail pages from the team browser.
- View a team summary with season, record, streak, standing, and last-game result.
- Jump from a team page to the relevant conference standings.
- View team stat cards for major team categories.
- Browse the team roster and player stat table.
- Toggle team player stats between regular season, playoffs, and play-in.
- Open player pages from team roster rows.
- Open full game logs from team last-game cards when available.

### Standings And Playoffs

- View standings by Eastern or Western Conference.
- Switch between standings and playoff bracket views.
- Review team rank, games back, record, win percentage, last 10, streak, home record, away record, PPG, and opponent PPG.
- Open team detail pages directly from standings rows.
- See postseason-eligible teams highlighted.
- Review playoff series by round and conference.

### Full Game Logs

- View complete game summaries by matchup.
- See team scores, date, season, and game identifier.
- Compare both teams' box-score totals.
- Review each team's player-level game table.
- Open a player-specific game summary from a full game log.

### Comments And Notifications

- Post comments on player pages.
- Reply to existing player comments.
- Like or unlike comments and replies.
- Delete your own comments and replies.
- See relative timestamps on discussion activity.
- Open direct reply threads from notifications.
- Receive profile notifications for replies and likes.
- Clear notification popups locally after reviewing them.

### Profile

- View account details and saved activity.
- Edit display username.
- Upload, preview, save, or remove a profile picture.
- Review favorite player, team, and stat counts.
- Preview recent favorite players, teams, and stat categories.
- Open the dashboard from the profile page.
- Change account password.
- Show or hide password fields while updating a password.

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

- `users` and `player_comments` use the local stats DB unless `MONGO_AUTH_URI` or `MONGO_AUTH_DB` are set.
- `player_cache` and `fetch_queue` use the stats DB.
