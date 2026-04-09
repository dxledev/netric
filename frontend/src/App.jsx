import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom"
import { useEffect } from "react"
import Home from "./pages/Home"
import PlayerSearch from "./pages/PlayerSearch"
import Login from "./pages/Login"
import Register from "./pages/Register"
import PlayerInfo from "./pages/PlayerInfo"
import GameSummary from "./pages/GameSummary"
import StatHighs from "./pages/StatHighs"
import { isAuthenticated } from "./auth"

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    })
  }, [pathname])

  return null
}

function ProtectedRoutes() {
  const location = useLocation()

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

function PublicOnlyRoutes() {
  if (isAuthenticated()) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicOnlyRoutes />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route element={<ProtectedRoutes />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<PlayerSearch />} />
          <Route path="/player/:id" element={<PlayerInfo />} />
          <Route path="/player/:id/games/:gameKey" element={<GameSummary />} />
          <Route path="/player/:id/game-highs/:statKey" element={<StatHighs />} />
        </Route>

        <Route path="*" element={<Navigate to={isAuthenticated() ? "/" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
