import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"

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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.24),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_24%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-6 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative hidden overflow-hidden border-r border-white/10 p-10 lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/15 via-transparent to-emerald-400/10" />

            <div className="relative">
              <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                Netric
              </div>
              <h1 className="mt-6 text-4xl font-semibold leading-tight text-white">
                Basketball insights with a cleaner front door.
              </h1>
              <p className="mt-4 max-w-md text-base text-slate-300">
                Sign in to jump back in to your personalized dashboard, refined player summaries, and in-depth analytics.
              </p>
            </div>

            <div className="relative rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">What’s inside</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-sm font-medium text-white">Favorite players</p>
                  <p className="mt-1 text-sm text-slate-300">All of the players you desire to track closely in one handy place.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-sm font-medium text-white">Player search</p>
                  <p className="mt-1 text-sm text-slate-300">Find players, teams, or stat categories, inspect current summaries, and favorite them in a singular flow.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8">
                <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
                  Welcome Back
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Sign in
                </h2>
                <p className="mt-2 text-sm text-slate-300 sm:text-base">
                  Input your account credentials to return to the dashboard.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-20 text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(current => !current)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-content-in">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full rounded-xl px-5 py-3 text-sm font-medium transition-all duration-300 ${
                    loading
                      ? "cursor-not-allowed bg-white/10 text-slate-400"
                      : "bg-white text-slate-950 shadow-lg shadow-white/10 hover:-translate-y-0.5 hover:bg-slate-100"
                  }`}
                >
                  {loading ? "Signing in..." : "Login"}
                </button>
              </form>

              <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-slate-950/35 px-5 py-4">
                <p className="text-sm text-slate-300">
                  Don&apos;t have an account?
                </p>
                <button
                  onClick={() => navigate("/register")}
                  className="mt-2 text-sm font-medium text-blue-300 transition-colors duration-300 hover:text-white"
                >
                  Create one here.
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
