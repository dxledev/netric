import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"
import AuthLayout from "../components/AuthLayout"

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const redirectTo = location.state?.from?.pathname || "/"

  const handleLogin = async e => {
    e.preventDefault()

    try {
      setLoading(true)
      setError(null)

      const res = await axios.post(`${API_BASE}/login`, { email, password })

      localStorage.setItem("token", res.data.access_token)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError("Invalid credentials")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Every swish has a number behind it."
      lede="Netric Sports is the net and the metric: NBA players, teams and standings, with the shooting splits and efficiency stats that explain what you watched."
      features={[
        ["bg-blue-400", "Stats that go past the box score", "Season averages, game logs, game highs, TS% and eFG%."],
        ["bg-red-400", "Compare players side by side", "Put two players and two seasons next to each other."],
        ["bg-orange-400", "Keep your own board", "Favorite the players and teams you follow."],
      ]}
    >
      <h2 className="text-3xl font-extrabold text-white">Sign in</h2>
      <p className="mt-2 text-slate-300">Pick up where you left off with your favorites and stats.</p>

      <form onSubmit={handleLogin} className="mt-8 space-y-5">
        <div>
          <label htmlFor="login-email" className="mb-2 block text-sm font-semibold text-slate-200">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 focus:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="mb-2 block text-sm font-semibold text-slate-200">
            Password
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 pr-20 text-white placeholder:text-slate-500 focus:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(current => !current)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-sm font-semibold text-blue-300 hover:bg-white/10 hover:text-white"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-100 animate-content-in">
            {error}. Check your email and password, then try again.
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`w-full rounded-xl px-5 py-3 text-base font-bold transition-colors ${
            loading
              ? "cursor-not-allowed bg-slate-700 text-slate-400"
              : "bg-orange-400 text-slate-950 hover:bg-orange-300"
          }`}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-8 border-t border-white/10 pt-6 text-slate-300">
        New to Netric?{" "}
        <button
          onClick={() => navigate("/register")}
          className="font-semibold text-orange-300 underline decoration-orange-300/40 underline-offset-4 hover:text-orange-200"
        >
          Create an account
        </button>
      </p>
    </AuthLayout>
  )
}
