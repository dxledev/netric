import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"
import ReturnHome from "../components/ReturnHome"

const EMPTY_FAVORITES = {
  players: [],
  teams: [],
  stats: [],
}
const MAX_PROFILE_IMAGE_SIZE = 1024 * 1024 * 2
const PROFILE_IMAGE_MAX_DIMENSION = 640
const PROFILE_IMAGE_QUALITY = 0.82

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/")
  const paddedValue = normalizedValue.padEnd(normalizedValue.length + ((4 - normalizedValue.length % 4) % 4), "=")

  return window.atob(paddedValue)
}

function decodeTokenPayload(token) {
  if (!token || typeof window === "undefined") {
    return null
  }

  try {
    const payloadSegment = token.split(".")[1]

    if (!payloadSegment) {
      return null
    }

    return JSON.parse(decodeBase64Url(payloadSegment))
  } catch (error) {
    console.error("Failed to decode profile token", error)
    return null
  }
}

function normalizeFavorites(data = {}) {
  return {
    players: Array.isArray(data.players) ? data.players : [],
    teams: Array.isArray(data.teams) ? data.teams : [],
    stats: Array.isArray(data.stats) ? data.stats : [],
  }
}

function getInitials(email) {
  const [name = "User"] = String(email || "User").split("@")
  const parts = name.split(/[._-]+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("")

  return initials || "U"
}

function getDisplayName(email) {
  const [name = "Netric User"] = String(email || "Netric User").split("@")

  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "Netric User"
}

function getProfileStorageKey(email, token) {
  if (email && email !== "Unknown email") {
    return `netric:profile:${email}`
  }

  return token ? `netric:profile:${token}` : null
}

function readStoredProfile(email, token) {
  if (typeof window === "undefined") {
    return null
  }

  const cacheKey = getProfileStorageKey(email, token)

  if (!cacheKey) {
    return null
  }

  try {
    const rawProfile = window.localStorage.getItem(cacheKey)

    if (!rawProfile) {
      return null
    }

    return JSON.parse(rawProfile)
  } catch (error) {
    console.error("Failed to read stored profile", error)
    return null
  }
}

function writeStoredProfile(email, token, profile) {
  if (typeof window === "undefined") {
    return false
  }

  const cacheKey = getProfileStorageKey(email, token)

  if (!cacheKey) {
    return false
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(profile))
    return true
  } catch (error) {
    console.error("Failed to save stored profile", error)
    return false
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Unable to read that image."))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Unable to load that image."))
    image.src = dataUrl
  })
}

async function prepareProfileImage(file) {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = largestSide > PROFILE_IMAGE_MAX_DIMENSION ? PROFILE_IMAGE_MAX_DIMENSION / largestSide : 1
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")

  if (!context) {
    return dataUrl
  }

  canvas.width = width
  canvas.height = height
  context.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL("image/jpeg", PROFILE_IMAGE_QUALITY)
}

export default function UserProfile() {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const profile = useMemo(() => decodeTokenPayload(token), [token])
  const email = profile?.sub || "Unknown email"
  const defaultUsername = getDisplayName(email)
  const [editableProfile, setEditableProfile] = useState(() => readStoredProfile(email, token) || {
    username: defaultUsername,
    image: null,
  })
  const [draftUsername, setDraftUsername] = useState(editableProfile.username || defaultUsername)
  const [draftImage, setDraftImage] = useState(editableProfile.image || null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState(null)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [passwordError, setPasswordError] = useState(null)
  const [showPasswordFields, setShowPasswordFields] = useState(false)
  const [favorites, setFavorites] = useState(EMPTY_FAVORITES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const storedProfile = readStoredProfile(email, token) || {
      username: defaultUsername,
      image: null,
    }

    setEditableProfile(storedProfile)
    setDraftUsername(storedProfile.username || defaultUsername)
    setDraftImage(storedProfile.image || null)
    setEditingProfile(false)
    setProfileMessage(null)
  }, [defaultUsername, email, token])

  useEffect(() => {
    if (!token) {
      navigate("/login")
      return undefined
    }

    let ignore = false

    axios
      .get(`${API_BASE}/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(res => {
        if (ignore) {
          return
        }

        setFavorites(normalizeFavorites(res.data))
        setError(null)
      })
      .catch(err => {
        if (ignore) {
          return
        }

        if (err?.response?.status === 401) {
          window.localStorage.removeItem("token")
          navigate("/login")
          return
        }

        setError("Unable to load profile activity right now.")
        console.error(err)
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [navigate, token])

  const totalFavorites = favorites.players.length + favorites.teams.length + favorites.stats.length
  const favoriteSections = [
    { label: "Players", value: favorites.players.length, color: "from-blue-500/20 to-cyan-400/10", text: "text-blue-100" },
    { label: "Teams", value: favorites.teams.length, color: "from-emerald-500/20 to-teal-400/10", text: "text-emerald-100" },
    { label: "Stats", value: favorites.stats.length, color: "from-amber-500/20 to-orange-400/10", text: "text-amber-100" },
  ]
  const favoritePlayers = favorites.players.slice(0, 5)
  const favoriteTeams = favorites.teams.slice(0, 5)
  const favoriteStats = favorites.stats.slice(0, 5)
  const username = editableProfile.username || defaultUsername
  const profileImage = editableProfile.image

  async function handleProfileImageChange(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith("image/")) {
      setProfileMessage("Please choose an image file.")
      return
    }

    if (file.size > MAX_PROFILE_IMAGE_SIZE) {
      setProfileMessage("Profile picture must be under 2 MB.")
      event.target.value = ""
      return
    }

    try {
      setProfileMessage("Preparing profile picture...")
      setDraftImage(await prepareProfileImage(file))
      setProfileMessage(null)
    } catch (error) {
      console.error(error)
      setProfileMessage("Unable to read that image.")
    } finally {
      event.target.value = ""
    }
  }

  function handleSaveProfile() {
    const trimmedUsername = draftUsername.trim()

    if (!trimmedUsername) {
      setProfileMessage("Username cannot be blank.")
      return
    }

    const nextProfile = {
      username: trimmedUsername,
      image: draftImage,
    }

    if (!writeStoredProfile(email, token, nextProfile)) {
      setProfileMessage("Unable to save profile picture in this browser. Try a smaller image.")
      return
    }

    setEditableProfile(nextProfile)
    setEditingProfile(false)
    setProfileMessage("Profile updated.")
  }

  function handleCancelEdit() {
    setDraftUsername(username)
    setDraftImage(profileImage || null)
    setEditingProfile(false)
    setProfileMessage(null)
  }

  async function handleChangePassword(event) {
    event.preventDefault()

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Fill out all password fields.")
      setPasswordMessage(null)
      return
    }

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.")
      setPasswordMessage(null)
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.")
      setPasswordMessage(null)
      return
    }

    try {
      setPasswordLoading(true)
      setPasswordError(null)
      setPasswordMessage(null)

      await axios.post(
        `${API_BASE}/change-password`,
        {
          current_password: currentPassword,
          new_password: newPassword,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPasswordMessage("Password updated.")
    } catch (err) {
      if (err?.response?.status === 401 && err?.response?.data?.detail !== "Current password is incorrect") {
        window.localStorage.removeItem("token")
        navigate("/login")
        return
      }

      setPasswordError(err?.response?.data?.detail || "Unable to update password right now.")
      console.error(err)
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-10 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-7xl">
        <div className="mb-6">
          <ReturnHome className="border border-white/10 bg-white/10 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15" />
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.5rem] border border-blue-300/20 bg-blue-400/15 text-3xl font-semibold text-blue-100 shadow-lg shadow-black/20">
                {profileImage ? (
                  <img
                    src={profileImage}
                    alt={`${username} profile`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  getInitials(username || email)
                )}
              </div>
              <div>
                <div className="mb-3 inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                  Profile
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  {username}
                </h1>
                <p className="mt-2 text-sm text-slate-300 sm:text-base">{email}</p>
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                onClick={() => {
                  setDraftUsername(username)
                  setDraftImage(profileImage || null)
                  setEditingProfile(true)
                  setProfileMessage(null)
                }}
                className="rounded-xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
              >
                Edit Profile
              </button>
              <button
                onClick={() => navigate("/search")}
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-950 shadow-lg shadow-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-100"
              >
                Search Players
              </button>
            </div>
          </div>

          {editingProfile && (
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5 animate-content-in">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-blue-300/20 bg-blue-400/15 text-2xl font-semibold text-blue-100">
                    {draftImage ? (
                      <img
                        src={draftImage}
                        alt="Profile preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getInitials(draftUsername || email)
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Profile Picture</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="cursor-pointer rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15">
                        Upload Image
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleProfileImageChange}
                        />
                      </label>
                      {draftImage && (
                        <button
                          onClick={() => setDraftImage(null)}
                          className="rounded-xl border border-white/15 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-red-500/25"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Username
                  </label>
                  <input
                    type="text"
                    value={draftUsername}
                    onChange={event => setDraftUsername(event.target.value)}
                    maxLength={40}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                    placeholder="Enter a username"
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
                  <button
                    onClick={handleSaveProfile}
                    className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-950 shadow-lg shadow-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-100"
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="rounded-xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {profileMessage && (
            <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100 animate-content-in">
              {profileMessage}
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-content-in">
              {error}
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {favoriteSections.map(section => (
              <div key={section.label} className={`rounded-2xl border border-white/10 bg-gradient-to-br ${section.color} p-4 shadow-lg shadow-black/15`}>
                <p className={`text-xs uppercase tracking-[0.24em] ${section.text}`}>{section.label}</p>
                <p className="mt-3 text-3xl font-semibold text-white">{loading ? "..." : section.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Account Details</p>
              <div className="mt-5 grid gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-sm text-slate-400">Username</p>
                  <p className="mt-1 break-all text-sm font-medium text-white">{username}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-sm text-slate-400">Email</p>
                  <p className="mt-1 break-all text-sm font-medium text-white">{email}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Saved Activity</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{loading ? "Loading favorites" : `${totalFavorites} saved items`}</h2>
                </div>
                <button
                  onClick={() => navigate("/")}
                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                >
                  View Dashboard
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-medium text-white">Favorite Players</p>
                  <div className="mt-3 space-y-2">
                    {favoritePlayers.length > 0 ? favoritePlayers.map(player => (
                      <p key={player.id || player.name} className="truncate text-sm text-slate-300">{player.name || player.id}</p>
                    )) : (
                      <p className="text-sm text-slate-400">No players saved yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-medium text-white">Favorite Teams</p>
                  <div className="mt-3 space-y-2">
                    {favoriteTeams.length > 0 ? favoriteTeams.map(team => (
                      <p key={team.id || team.abbreviation || team.name || team} className="truncate text-sm text-slate-300">
                        {team.name || team.abbreviation || team}
                      </p>
                    )) : (
                      <p className="text-sm text-slate-400">No teams saved yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-medium text-white">Favorite Stats</p>
                  <div className="mt-3 space-y-2">
                    {favoriteStats.length > 0 ? favoriteStats.map(stat => (
                      <p key={stat.id || stat.key || stat.name || stat} className="truncate text-sm text-slate-300">
                        {stat.name || stat.label || stat.key || stat}
                      </p>
                    )) : (
                      <p className="text-sm text-slate-400">No stats saved yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-6">
            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Security</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">Change Password</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordFields(current => !current)}
                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                  aria-label={showPasswordFields ? "Hide password fields" : "Show password fields"}
                >
                  {showPasswordFields ? "Hide Passwords" : "Show Passwords"}
                </button>
              </div>

              <form onSubmit={handleChangePassword} className="mt-5 grid gap-4 lg:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordFields ? "text" : "password"}
                      value={currentPassword}
                      onChange={event => setCurrentPassword(event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-20 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                      placeholder="Current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields(current => !current)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                      aria-label={showPasswordFields ? "Hide password fields" : "Show password fields"}
                    >
                      {showPasswordFields ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordFields ? "text" : "password"}
                      value={newPassword}
                      onChange={event => setNewPassword(event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-20 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                      placeholder="New password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields(current => !current)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                      aria-label={showPasswordFields ? "Hide password fields" : "Show password fields"}
                    >
                      {showPasswordFields ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordFields ? "text" : "password"}
                      value={confirmPassword}
                      onChange={event => setConfirmPassword(event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-20 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields(current => !current)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                      aria-label={showPasswordFields ? "Hide password fields" : "Show password fields"}
                    >
                      {showPasswordFields ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:col-span-3 lg:flex-row lg:items-center">
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className={`rounded-xl px-5 py-3 text-sm font-medium transition-all duration-300 ${
                      passwordLoading
                        ? "cursor-not-allowed bg-white/10 text-slate-400"
                        : "bg-white text-slate-950 shadow-lg shadow-white/10 hover:-translate-y-0.5 hover:bg-slate-100"
                    }`}
                  >
                    {passwordLoading ? "Updating..." : "Update Password"}
                  </button>

                  {passwordMessage && (
                    <p className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                      {passwordMessage}
                    </p>
                  )}

                  {passwordError && (
                    <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                      {passwordError}
                    </p>
                  )}
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
