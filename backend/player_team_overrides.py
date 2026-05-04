NBA_TEAMS_BY_ABBREVIATION = {
    "ATL": {"id": 1610612737, "name": "Atlanta Hawks", "abbreviation": "ATL"},
    "BKN": {"id": 1610612751, "name": "Brooklyn Nets", "abbreviation": "BKN"},
    "BOS": {"id": 1610612738, "name": "Boston Celtics", "abbreviation": "BOS"},
    "CHA": {"id": 1610612766, "name": "Charlotte Hornets", "abbreviation": "CHA"},
    "CHI": {"id": 1610612741, "name": "Chicago Bulls", "abbreviation": "CHI"},
    "CLE": {"id": 1610612739, "name": "Cleveland Cavaliers", "abbreviation": "CLE"},
    "DAL": {"id": 1610612742, "name": "Dallas Mavericks", "abbreviation": "DAL"},
    "DET": {"id": 1610612765, "name": "Detroit Pistons", "abbreviation": "DET"},
    "GSW": {"id": 1610612744, "name": "Golden State Warriors", "abbreviation": "GSW"},
    "IND": {"id": 1610612754, "name": "Indiana Pacers", "abbreviation": "IND"},
    "LAC": {"id": 1610612746, "name": "Los Angeles Clippers", "abbreviation": "LAC"},
    "LAL": {"id": 1610612747, "name": "Los Angeles Lakers", "abbreviation": "LAL"},
    "MEM": {"id": 1610612763, "name": "Memphis Grizzlies", "abbreviation": "MEM"},
    "MIL": {"id": 1610612749, "name": "Milwaukee Bucks", "abbreviation": "MIL"},
    "MIN": {"id": 1610612750, "name": "Minnesota Timberwolves", "abbreviation": "MIN"},
    "NOP": {"id": 1610612740, "name": "New Orleans Pelicans", "abbreviation": "NOP"},
    "NYK": {"id": 1610612752, "name": "New York Knicks", "abbreviation": "NYK"},
    "OKC": {"id": 1610612760, "name": "Oklahoma City Thunder", "abbreviation": "OKC"},
    "PHX": {"id": 1610612756, "name": "Phoenix Suns", "abbreviation": "PHX"},
    "POR": {"id": 1610612757, "name": "Portland Trail Blazers", "abbreviation": "POR"},
    "SAC": {"id": 1610612758, "name": "Sacramento Kings", "abbreviation": "SAC"},
    "TOR": {"id": 1610612761, "name": "Toronto Raptors", "abbreviation": "TOR"},
    "UTA": {"id": 1610612762, "name": "Utah Jazz", "abbreviation": "UTA"},
    "WAS": {"id": 1610612764, "name": "Washington Wizards", "abbreviation": "WAS"},
}


# Official 2025-26 NBA trade tracker corrections for players whose season
# totals can still point at their pre-trade team until they play after a deal.
PLAYER_TEAM_OVERRIDES = {
    101108: "TOR",      # Chris Paul
    201144: "CHA",      # Mike Conley
    201569: "MEM",      # Eric Gordon
    201935: "CLE",      # James Harden
    202696: "BOS",      # Nikola Vucevic
    203076: "WAS",      # Anthony Davis
    203114: "DAL",      # Khris Middleton
    203468: "ATL",      # CJ McCollum
    203471: "CLE",      # Dennis Schroder
    203486: "OKC",      # Mason Plumlee
    203937: "MEM",      # Kyle Anderson
    203957: "WAS",      # Dante Exum
    203967: "DET",      # Dario Saric
    204001: "GSW",      # Kristaps Porzingis
    1626145: "DAL",     # Tyus Jones
    1626156: "WAS",     # D'Angelo Russell
    1627741: "ATL",     # Buddy Hield
    1627777: "MEM",     # Georges Niang
    1627824: "CHI",     # Guerschon Yabusele
    1627826: "IND",     # Ivica Zubac
    1628366: "UTA",     # Lonzo Ball
    1628379: "LAL",     # Luke Kennard
    1628502: "MIL",     # Nigel Hayes-Davis
    1628963: "DAL",     # Marvin Bagley III
    1628989: "DET",     # Kevin Huerter
    1628991: "UTA",     # Jaren Jackson Jr.
    1629012: "CHI",     # Collin Sexton
    1629014: "BOS",     # Anfernee Simons
    1629027: "WAS",     # Trae Young
    1629216: "ATL",     # Gabe Vincent
    1629599: "PHX",     # Amir Coffey
    1629631: "SAC",     # De'Andre Hunter
    1629632: "CHA",     # Coby White
    1629636: "LAC",     # Darius Garland
    1629723: "UTA",     # John Konchar
    1630175: "PHX",     # Cole Anthony
    1630208: "CHI",     # Nick Richards
    1630214: "CHA",     # Xavier Tillman
    1630228: "ATL",     # Jonathan Kuminga
    1630245: "MIN",     # Ayo Dosunmu
    1630249: "POR",     # Vit Krejci
    1630534: "BKN",     # Ochai Agbaji
    1630543: "LAC",     # Isaiah Jackson
    1630557: "ATL",     # Corey Kispert
    1630631: "NYK",     # Jose Alvarado
    1630702: "WAS",     # Jaden Hardy
    1631093: "CHI",     # Jaden Ivey
    1631097: "LAC",     # Bennedict Mathurin
    1631103: "CHA",     # Malaki Branham
    1631159: "CHI",     # Leonard Miller
    1631165: "CLE",     # Keon Ellis
    1631169: "BKN",     # Josh Minott
    1631172: "MIL",     # Ousmane Dieng
    1631207: "NOP",     # Dalen Terry
    1631218: "TOR",     # Trayce Jackson-Davis
    1631246: "UTA",     # Vince Williams Jr.
    1641707: "MEM",     # Taylor Hendricks
    1641738: "IND",     # Kobe Brown
    1641763: "MIN",     # Julian Phillips
    1641801: "CLE",     # Emanuel Miller
    1641816: "BKN",     # Hunter Tyson
    1641871: "ATL",     # Duop Reath
    1642265: "CHI",     # Rob Dillingham
    1642272: "OKC",     # Jared McCain
    1642358: "DAL",     # AJ Johnson
    1642383: "MEM",     # Walter Clayton Jr.
}


def get_player_team_override(player_id):
    abbreviation = PLAYER_TEAM_OVERRIDES.get(int(player_id))
    if not abbreviation:
        return None

    team = NBA_TEAMS_BY_ABBREVIATION[abbreviation]
    return dict(team)
