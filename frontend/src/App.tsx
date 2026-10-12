import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getToken, onSessionChange } from './lib/session'
import type { Platform } from './lib/api'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NetworkPage from './pages/NetworkPage'
import Assistant from './pages/Assistant'
import Users from './pages/Users'

// Une page par réseau: vue d'ensemble, publications, commentaires, calendrier et conseils.
const NETWORKS: Platform[] = ['facebook', 'instagram', 'linkedin', 'tiktok']

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  useEffect(() => onSessionChange(() => setAuthed(!!getToken())), [])

  if (!authed) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        {NETWORKS.map((p) => <Route key={p} path={p} element={<NetworkPage key={p} platform={p} />} />)}
        <Route path="assistant" element={<Assistant />} />
        <Route path="users" element={<Users />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
