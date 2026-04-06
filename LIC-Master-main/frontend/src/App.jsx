import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: API_BASE,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lic_token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('lic_token'))
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('lic_user')
    return raw ? JSON.parse(raw) : null
  })

  const saveAuth = (newToken, newUser) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('lic_token', newToken)
    localStorage.setItem('lic_user', JSON.stringify(newUser))
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('lic_token')
    localStorage.removeItem('lic_user')
  }

  return { token, user, saveAuth, logout }
}

const adminApi = axios.create({
  baseURL: API_BASE,
})

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('lic_admin_token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function normalizeClaimDocuments(claim) {
  const list = claim?.documents || []
  return list.map((d, i) => {
    if (typeof d === 'string') {
      return { originalName: d, canDownload: false }
    }
    const originalName = d?.originalName || `Document ${i + 1}`
    const storedPath = d?.storedPath || ''
    return { originalName, canDownload: Boolean(storedPath) }
  })
}

function claimCategoryInfo(claimType) {
  const map = {
    Maturity: { description: 'Maturity benefit — policy term completion' },
    Death: { description: 'Life claim — death benefit for nominees' },
    Surrender: { description: 'Surrender value — early policy closure' },
    Health: { description: 'Health / medical rider or hospitalization' },
  }
  return map[claimType || ''] || { description: 'Insurance claim submission' }
}

const POLICY_NUMBER_REGEX = /^[0-9]{6,10}$/

function sanitizePolicyDigits(value) {
  return String(value).replace(/\D/g, '').slice(0, 10)
}

function policyNumberFieldError(digits, inputHadNonDigit) {
  const t = String(digits).trim()
  if (POLICY_NUMBER_REGEX.test(t)) return ''
  if (t.length === 0) return 'Policy number is required'
  if (inputHadNonDigit) return 'Policy number must contain only numbers'
  if (t.length < 6) return 'Policy number must be at least 6 digits'
  if (t.length > 10) return 'Policy number must not exceed 10 digits'
  return ''
}

function LoginPage({ onLogin }) {
  const [policyNumber, setPolicyNumber] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [policyFieldError, setPolicyFieldError] = useState('')

  const requestOtp = async () => {
    setPolicyFieldError('')
    setError('')
    const pErr = policyNumberFieldError(policyNumber, false)
    if (pErr) {
      setPolicyFieldError(pErr)
      return
    }
    setLoading(true)
    setInfo('')
    try {
      const { data } = await api.post('/auth/request-otp', {
        policyNumber,
        mobileNumber,
      })
      setOtpRequested(true)
      setOtp('')
      setInfo(`OTP sent (for demo: ${data.otp})`)
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  const resendOtp = async () => {
    setPolicyFieldError('')
    setError('')
    const pErr = policyNumberFieldError(policyNumber, false)
    if (pErr) {
      setPolicyFieldError(pErr)
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/request-otp', {
        policyNumber,
        mobileNumber,
      })
      setOtp('')
      setInfo(`New OTP sent (for demo: ${data.otp})`)
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/verify-otp', {
        policyNumber,
        otp: String(otp).trim(),
      })
      onLogin(data.token, data.user)
    } catch (e) {
      setError(e.response?.data?.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-lg p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-slate-50">
            LIC Claims Portal
          </h1>
          <p className="text-sm text-slate-400">
            Login with your policy number and registered mobile
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 px-3 py-2 rounded">
            <p className="font-medium">{error}</p>
            {otpRequested && (
              <p className="mt-2 text-xs text-red-300/90">
                The demo OTP below stays visible. Edit your entry or use Resend OTP for a new code.
              </p>
            )}
          </div>
        )}
        {info && (
          <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-3 py-2 rounded">
            {info}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-slate-300">
              Policy Number
            </label>
            <input
              className={`w-full rounded-md border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 ${
                policyFieldError
                  ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                  : 'border-slate-700 focus:ring-amber-400 focus:border-amber-400'
              }`}
              placeholder="6–10 digits"
              inputMode="numeric"
              value={policyNumber}
              onChange={(e) => {
                const raw = e.target.value
                const hadNonDigit = /[^0-9]/.test(raw)
                const d = sanitizePolicyDigits(raw)
                setPolicyNumber(d)
                setPolicyFieldError(policyNumberFieldError(d, hadNonDigit))
              }}
              aria-invalid={policyFieldError ? true : undefined}
            />
            {policyFieldError && (
              <p className="mt-1.5 text-sm text-red-400" role="alert">
                {policyFieldError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-300">
              Registered Mobile Number
            </label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
            />
          </div>

          {otpRequested && (
            <div>
              <label className="block text-sm mb-1 text-slate-300">OTP</label>
              <input
                className={`w-full rounded-md border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 ${
                  error && otpRequested
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                    : 'border-slate-700 focus:ring-amber-400 focus:border-amber-400'
                }`}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value)
                  setError('')
                }}
                aria-invalid={error && otpRequested ? true : undefined}
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          {!otpRequested ? (
            <button
              onClick={requestOtp}
              disabled={loading || !POLICY_NUMBER_REGEX.test(policyNumber)}
              className="w-full inline-flex justify-center items-center rounded-md bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-medium px-4 py-2 disabled:opacity-60"
            >
              {loading ? 'Requesting OTP...' : 'Request OTP'}
            </button>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={verifyOtp}
                disabled={loading}
                className="w-full inline-flex justify-center items-center rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-medium px-4 py-2 disabled:opacity-60"
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
              <button
                type="button"
                onClick={resendOtp}
                disabled={loading}
                className="w-full inline-flex justify-center items-center rounded-md border border-amber-500/40 text-amber-300 text-sm font-medium px-4 py-2 hover:bg-amber-500/10 disabled:opacity-60"
              >
                Resend OTP (new code)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Shell({ onLogout, user }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-amber-400 flex items-center justify-center text-slate-900 font-bold text-sm">
              LIC
            </div>
            <div>
              <p className="text-sm font-semibold">LIC Claims Portal</p>
              <p className="text-xs text-slate-400">
                Policy #{user?.policyNumber}
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link className="text-slate-300 hover:text-amber-400" to="/dashboard">
              Dashboard
            </Link>
            <Link className="text-slate-300 hover:text-amber-400" to="/chatbot">
              Chatbot
            </Link>
            <Link className="text-slate-300 hover:text-amber-400" to="/claims/new">
              New Claim
            </Link>
            <Link className="text-slate-300 hover:text-amber-400" to="/claims/status">
              Claim Status
            </Link>
            <button
              onClick={onLogout}
              className="ml-4 text-xs border border-slate-700 rounded-full px-3 py-1 hover:border-amber-400 hover:text-amber-300"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chatbot" element={<Chatbot />} />
            <Route path="/claims/new" element={<NewClaim />} />
            <Route path="/claims/status" element={<ClaimStatus />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function Dashboard() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-semibold mb-1">Welcome to LIC Claims</h2>
        <p className="text-sm text-slate-300">
          Use the chatbot for instant guidance, submit new insurance claims online, and track
          the status of your existing claims without visiting a branch.
        </p>
        <ul className="mt-2 text-sm text-slate-200 space-y-1 list-disc list-inside">
          <li>AI chatbot assistance for claim queries and required documents</li>
          <li>Online claim registration with document upload support (demo filenames)</li>
          <li>Real-time claim status tracking</li>
          <li>Secure access using your policy and mobile number</li>
        </ul>
      </section>
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-2">
        <h3 className="text-sm font-semibold text-slate-100">Quick actions</h3>
        <div className="flex flex-col gap-2 mt-2">
          <Link
            to="/chatbot"
            className="rounded-md bg-amber-500/90 hover:bg-amber-400 text-slate-900 text-sm font-medium px-3 py-2 text-center"
          >
            Ask the chatbot
          </Link>
          <Link
            to="/claims/new"
            className="rounded-md border border-slate-700 hover:border-amber-400 text-sm px-3 py-2 text-center"
          >
            Submit a new claim
          </Link>
          <Link
            to="/claims/status"
            className="rounded-md border border-slate-700 hover:border-amber-400 text-sm px-3 py-2 text-center"
          >
            Check claim status
          </Link>
        </div>
      </section>
    </div>
  )
}

function Chatbot() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await api.get('/chatbot/history')
        setMessages(data)
      } catch {
        // ignore
      }
    }
    fetchHistory().catch(() => {})
  }, [])

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed) return
    try {
      const { data } = await api.post('/chatbot/message', { message: trimmed })
      setMessages((prev) => [...prev, data.user, data.bot])
      setInput('')
    } catch {
      // ignore for now
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-[520px]">
      <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-bold text-slate-900">
          AI
        </div>
        <div>
          <p className="text-sm font-semibold">LIC Claim Assistant</p>
          <p className="text-xs text-slate-400">
            Ask about claim process, required documents, or status
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m) => (
          <div
            key={m._id + m.createdAt}
            className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.sender === 'user'
                  ? 'bg-amber-500 text-slate-900 rounded-br-sm'
                  : 'bg-slate-800 text-slate-100 rounded-bl-sm'
              }`}
            >
              {m.message}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-xs text-slate-500 text-center mt-8">
            Start the conversation by asking how to file a claim or what documents are required.
          </p>
        )}
      </div>
      <div className="border-t border-slate-800 px-3 py-3 flex gap-2">
        <input
          className="flex-1 rounded-full bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
          placeholder="Type your question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="rounded-full bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-medium px-4"
        >
          Send
        </button>
      </div>
    </div>
  )
}

function NewClaim() {
  const [form, setForm] = useState({
    policyNumber: '',
    policyholderName: '',
    claimType: '',
    reason: '',
  })
  const [newClaimPolicyError, setNewClaimPolicyError] = useState(() =>
    policyNumberFieldError('', false)
  )
  const [documents, setDocuments] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const rawUser = localStorage.getItem('lic_user')
    if (rawUser) {
      const u = JSON.parse(rawUser)
      const d = sanitizePolicyDigits(u.policyNumber || '')
      setForm((f) => ({ ...f, policyNumber: d }))
      setNewClaimPolicyError(policyNumberFieldError(d, false))
    }
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'policyNumber') {
      const hadNonDigit = /[^0-9]/.test(value)
      const d = sanitizePolicyDigits(value)
      setForm((prev) => ({ ...prev, policyNumber: d }))
      setNewClaimPolicyError(policyNumberFieldError(d, hadNonDigit))
      return
    }
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const pErr = policyNumberFieldError(form.policyNumber, false)
    if (pErr) {
      setNewClaimPolicyError(pErr)
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      if (documents) {
        Array.from(documents).forEach((file) => fd.append('documents', file))
      }
      const { data } = await api.post('/claims', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMessage('Claim submitted successfully. Default status: Pending.')
      setForm((f) => ({ ...f, claimType: '', reason: '' }))
      setDocuments(null)
    } catch (err) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">Submit New Claim</h2>
      <p className="text-xs text-slate-400">
        Fill in the claim details and upload supporting documents. The claim will be created with
        status <span className="font-semibold text-amber-300">Pending</span>.
      </p>
      {error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 px-3 py-2 rounded">
          {error}
        </div>
      )}
      {message && (
        <div className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-3 py-2 rounded">
          {message}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-slate-300">
              Policy Number
            </label>
            <input
              name="policyNumber"
              className={`w-full rounded-md border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 ${
                newClaimPolicyError
                  ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                  : 'border-slate-700 focus:ring-amber-400 focus:border-amber-400'
              }`}
              placeholder="6–10 digits"
              inputMode="numeric"
              value={form.policyNumber}
              onChange={handleChange}
            />
            {newClaimPolicyError && (
              <p className="mt-1.5 text-sm text-red-400" role="alert">
                {newClaimPolicyError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-300">
              Policyholder Name
            </label>
            <input
              name="policyholderName"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              value={form.policyholderName}
              onChange={handleChange}
            />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-slate-300">
              Claim Type
            </label>
            <input
              name="claimType"
              placeholder="e.g. Maturity, Death, Health"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              value={form.claimType}
              onChange={handleChange}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1 text-slate-300">
            Reason / Description
          </label>
          <textarea
            name="reason"
            rows={3}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            value={form.reason}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-slate-300">
            Supporting Documents
          </label>
          <input
            type="file"
            multiple
            className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-amber-500 file:text-slate-900 hover:file:bg-amber-400"
            onChange={(e) => setDocuments(e.target.files)}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Demo implementation stores only file names on the server.
          </p>
        </div>
        <button
          type="submit"
          disabled={loading || !POLICY_NUMBER_REGEX.test(form.policyNumber)}
          className="inline-flex items-center justify-center rounded-md bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-medium px-4 py-2 disabled:opacity-60"
        >
          {loading ? 'Submitting...' : 'Submit Claim'}
        </button>
      </form>
    </div>
  )
}

function ClaimStatus() {
  const [policyNumber, setPolicyNumber] = useState('')
  const [claims, setClaims] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const rawUser = localStorage.getItem('lic_user')
    if (rawUser) {
      const u = JSON.parse(rawUser)
      setPolicyNumber(u.policyNumber)
    }
  }, [])

  const fetchClaims = async () => {
    setLoading(true)
    setError('')
    try {
      const params = policyNumber ? { policyNumber } : {}
      const { data } = await api.get('/claims', { params })
      setClaims(data)
    } catch (err) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Track Claim Status</h2>
        <p className="text-xs text-slate-400">
          Enter your policy number to view all claims and their current status.
        </p>
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 px-3 py-2 rounded">
            {error}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <input
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            value={policyNumber}
            onChange={(e) => setPolicyNumber(e.target.value)}
            placeholder="Policy number"
          />
          <button
            onClick={fetchClaims}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-md bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-medium px-4 py-2 disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Get Status'}
          </button>
        </div>
      </div>
      {claims.length > 0 && (
        <div className="space-y-2">
          {claims.map((c) => (
            <div
              key={c._id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 text-sm">
                <p className="font-medium text-slate-100">
                  {c.claimType} claim •{' '}
                  <span className="text-slate-400">#{c._id.slice(-6)}</span>
                </p>
                <p className="text-slate-300 text-xs">{c.reason}</p>
                {c.remarks && (
                  <p className="text-xs text-slate-400">Remarks: {c.remarks}</p>
                )}
              </div>
              <div className="text-right">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                    c.status === 'Approved'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : c.status === 'Rejected'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                      : 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  }`}
                >
                  {c.status}
                </span>
                <p className="mt-1 text-[11px] text-slate-500">
                  Submitted on {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {claims.length === 0 && (
        <p className="text-xs text-slate-500">
          No claims found yet for this policy.
        </p>
      )}
    </div>
  )
}

function AdminLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await adminApi.post('/admin/login', { username, password })
      localStorage.setItem('lic_admin_token', data.token)
      navigate('/admin/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Admin login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl shadow-2xl shadow-amber-500/10 p-8 space-y-6 backdrop-blur">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">LIC Admin Console</h1>
          <p className="text-xs text-slate-400">
            Sign in to review and manage claims.
          </p>
        </div>
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 px-3 py-2 rounded">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-slate-300">Username</label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-300">Password</label>
            <input
              type="password"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex justify-center items-center rounded-md bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-medium px-4 py-2 disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in as Admin'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AdminShell() {
  const navigate = useNavigate()
  const token = localStorage.getItem('lic_admin_token')

  useEffect(() => {
    if (!token) {
      navigate('/admin/login', { replace: true })
    }
  }, [token, navigate])

  const logout = () => {
    localStorage.removeItem('lic_admin_token')
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-slate-900 font-bold text-sm shadow-lg shadow-amber-500/40">
              LA
            </div>
            <div>
              <p className="text-sm font-semibold">LIC Admin Dashboard</p>
              <p className="text-[11px] text-slate-400">Claims management</p>
            </div>
          </div>
          <nav className="flex items-center gap-4 text-xs md:text-sm">
            <Link className="text-slate-300 hover:text-amber-400" to="/admin/dashboard">
              Claims
            </Link>
            <button
              onClick={logout}
              className="ml-2 text-xs border border-slate-700 rounded-full px-3 py-1 hover:border-amber-400 hover:text-amber-300"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
          <Routes>
            <Route path="/dashboard" element={<AdminDashboard />} />
            <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function AdminDashboard() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState('')
  const [remarks, setRemarks] = useState('')
  const [updating, setUpdating] = useState(false)

  const loadClaims = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await adminApi.get('/admin/claims')
      setClaims(data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClaims()
  }, [])

  const openClaim = (claim) => {
    setSelected(claim)
    setStatus(claim.status)
    setRemarks(claim.remarks || '')
  }

  const handleUpdate = async () => {
    if (!selected) return
    setUpdating(true)
    try {
      await adminApi.put(`/admin/claims/${selected._id}`, { status, remarks })
      await loadClaims()
      setSelected(null)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update claim')
    } finally {
      setUpdating(false)
    }
  }

  const downloadClaimDocument = async (claimId, fileIndex, originalName) => {
    setError('')
    try {
      const res = await adminApi.get(`/admin/claims/${claimId}/files/${fileIndex}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = originalName || 'document'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      let msg = 'Could not download file'
      const data = err.response?.data
      if (data instanceof Blob) {
        try {
          const text = await data.text()
          const j = JSON.parse(text)
          if (j.message) msg = j.message
        } catch {
          /* ignore */
        }
      } else if (err.response?.data?.message) {
        msg = err.response.data.message
      }
      setError(msg)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Submitted Claims</h2>
          <p className="text-xs text-slate-400">
            Review, verify, and update claim statuses for LIC policyholders.
          </p>
        </div>
        <button
          onClick={loadClaims}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md bg-slate-800 hover:bg-slate-700 text-xs md:text-sm px-3 py-1.5 border border-slate-700 hover:border-amber-400 disabled:opacity-60"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 px-3 py-2 rounded">
          {error}
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-xl shadow-lg shadow-slate-900/40 overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-300 uppercase tracking-wide">
              Claims ({claims.length})
            </p>
          </div>
          <div className="max-h-[420px] overflow-auto divide-y divide-slate-800">
            {claims.map((c) => (
              <button
                key={c._id}
                onClick={() => openClaim(c)}
                className="w-full text-left px-4 py-3 hover:bg-slate-800/70 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {c.claimType} •{' '}
                    <span className="text-xs text-amber-300/90 font-semibold">
                      Policy {c.policyNumber}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400 line-clamp-2">{c.reason}</p>
                  <p className="text-[11px] text-slate-500">
                    Submitted {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium ${
                    c.status === 'Approved'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                      : c.status === 'Rejected'
                      ? 'bg-red-500/15 text-red-300 border border-red-500/40'
                      : 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
                  }`}
                >
                  {c.status}
                </span>
              </button>
            ))}
            {claims.length === 0 && !loading && (
              <p className="text-xs text-slate-500 px-4 py-6 text-center">
                No claims submitted yet.
              </p>
            )}
          </div>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl shadow-lg shadow-slate-900/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Claim details</h3>
          {selected ? (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-slate-400">
                <p className="text-slate-200 font-medium">Policy {selected.policyNumber}</p>
                <p>ID: {selected._id}</p>
              </div>
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-amber-200/80">Insurance category</p>
                <p className="font-semibold text-amber-100">{selected.claimType} claim</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {claimCategoryInfo(selected.claimType).description}
                </p>
              </div>
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{selected.reason}</p>
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Uploaded documents</p>
                {normalizeClaimDocuments(selected).length === 0 ? (
                  <p className="text-[11px] text-slate-500">No documents uploaded.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {normalizeClaimDocuments(selected).map((doc, idx) => (
                      <li
                        key={`${selected._id}-d-${idx}`}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate text-slate-300" title={doc.originalName}>
                          {doc.originalName}
                        </span>
                        {doc.canDownload ? (
                          <button
                            type="button"
                            onClick={() => downloadClaimDocument(selected._id, idx, doc.originalName)}
                            className="shrink-0 text-amber-300 hover:text-amber-200 underline"
                          >
                            Download
                          </button>
                        ) : (
                          <span className="shrink-0 text-slate-500">No file</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="block text-xs text-slate-300 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <label className="block text-xs text-slate-300 mt-3 mb-1">
                  Remarks
                </label>
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  className="mt-2 inline-flex items-center justify-center rounded-md bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-medium px-3 py-1.5 disabled:opacity-60"
                >
                  {updating ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Select a claim from the list to review details and update its status.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function App() {
  const auth = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        {/* User routes */}
        <Route
          path="/*"
          element={
            auth.token ? (
              <Shell onLogout={auth.logout} user={auth.user} />
            ) : (
              <LoginPage onLogin={auth.saveAuth} />
            )
          }
        />

        {/* Admin routes */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/*" element={<AdminShell />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
