import { useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"
import AuthLayout from "../components/AuthLayout"

export default function Register() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleRegister = async e => {
    e.preventDefault()

    try {
      setLoading(true)
      setError(null)

      await axios.post(`${API_BASE}/register`, { email, password })

      navigate("/login")
    } catch {
      setError("Registration failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Start your own box score."
      lede="Make an account to favorite players and teams, then open one dashboard that shows how they are playing right now."
      features={[
        ["bg-blue-400", "Search any player or team", "Find them by name, city, nickname or stat category."],
        ["bg-red-400", "Sort your board", "Rank favorites by PTS, AST, REB, TS% and more."],
        ["bg-orange-400", "Join the conversation", "Comment on players and reply to other fans."],
      ]}
    >
      <h2 className="text-3xl font-extrabold text-white">Create your account</h2>
      <p className="mt-2 text-slate-300">It takes an email and a password. Then search for players and start your board.</p>

      <form onSubmit={handleRegister} className="mt-8 space-y-5">
        <div>
          <label htmlFor="register-email" className="mb-2 block text-sm font-semibold text-slate-200">
            Email
          </label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 focus:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="register-password" className="mb-2 block text-sm font-semibold text-slate-200">
            Password
          </label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white placeholder:text-slate-500 focus:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-100 animate-content-in">
            {error}. Check that the email is valid and not already registered.
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
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-8 border-t border-white/10 pt-6 text-slate-300">
        Already have an account?{" "}
        <button
          onClick={() => navigate("/login")}
          className="font-semibold text-orange-300 underline decoration-orange-300/40 underline-offset-4 hover:text-orange-200"
        >
          Sign in
        </button>
      </p>
    </AuthLayout>
  )
}
