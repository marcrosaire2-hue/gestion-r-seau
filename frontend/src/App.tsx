import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getToken, onSessionChange } from './lib/session'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Networks from './pages/Networks'
import Posts from './pages/Posts'
import Calendar from './pages/Calendar'
import Inbox from './pages/Inbox'
import Analytics from './pages/Analytics'
import Assistant from './pages/Assistant'

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  useEffect(() => onSessionChange(() => setAuthed(!!getToken())), [])

  if (!authed) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="networks" element={<Networks />} />
        <Route path="posts" element={<Posts />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
