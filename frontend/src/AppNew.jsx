import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'

const API_BASE = 'http://localhost:5000/api'

const api = axios.create({ baseURL: API_BASE })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lic_token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})




api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('lic_token')
      localStorage.removeItem('lic_user')
      localStorage.removeItem(CURRENT_POLICY_STORAGE_KEY)
      window.location.href = '/'
    }
    return Promise.reject(error)
  }
)

const adminApi = axios.create({ baseURL: API_BASE })
adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('lic_admin_token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('lic_admin_token')
      window.location.href = '/admin/login'
    }
    return Promise.reject(error)
  }
)

/** All saved docs in one array; each entry MUST include `policyNumber`. */
const MY_DOCUMENTS_STORAGE_KEY = 'lic_my_documents'
const CURRENT_POLICY_STORAGE_KEY = 'lic_current_policy_number'

function readAllStoredDocuments() {
  try {
    const raw = localStorage.getItem(MY_DOCUMENTS_STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persistAllDocuments(all) {
  localStorage.setItem(MY_DOCUMENTS_STORAGE_KEY, JSON.stringify(all))
}

function getDocumentsForPolicy(policyNumber) {
  const p = String(policyNumber || '').trim()
  if (!p) return []
  return readAllStoredDocuments().filter((d) => String(d.policyNumber || '').trim() === p)
}

function appendDocumentsForPolicy(policyNumber, newEntries) {
  const p = String(policyNumber || '').trim()
  if (!p) return
  const tagged = newEntries.map((doc) => ({ ...doc, policyNumber: p }))
  persistAllDocuments([...readAllStoredDocuments(), ...tagged])
}

function removeDocumentByIdForPolicy(policyNumber, id) {
  const p = String(policyNumber || '').trim()
  const next = readAllStoredDocuments().filter(
    (d) => !(String(d.policyNumber || '').trim() === p && d.id === id)
  )
  persistAllDocuments(next)
}

const ALLOWED_DOC_TYPES = /^(application\/pdf|image\/(jpeg|png))$/i

function isAllowedMyDocumentFile(file) {
  if (file?.type && ALLOWED_DOC_TYPES.test(file.type)) return true
  return /\.(pdf|jpe?g|png)$/i.test(file?.name || '')
}

/** Build a File from a stored My Document (data URL). */
function fileFromStoredDocument(doc) {
  if (!doc?.data || !doc?.name) return null
  try {
    const arr = doc.data.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/octet-stream'
    const bstr = atob(arr[1])
    const u8 = new Uint8Array(bstr.length)
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i)
    return new File([u8], doc.name, { type: mime })
  } catch {
    return null
  }
}

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('lic_token'))
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('lic_user')
    if (!raw) return null
    const u = JSON.parse(raw)
    if (u?.policyNumber != null && String(u.policyNumber).trim() !== '') {
      localStorage.setItem(CURRENT_POLICY_STORAGE_KEY, String(u.policyNumber).trim())
    }
    return u
  })

  const saveAuth = (newToken, newUser) => {
    localStorage.setItem('lic_token', newToken)
    localStorage.setItem('lic_user', JSON.stringify(newUser))
    if (newUser?.policyNumber != null && String(newUser.policyNumber).trim() !== '') {
      localStorage.setItem(CURRENT_POLICY_STORAGE_KEY, String(newUser.policyNumber).trim())
    }
    setToken(newToken)
    setUser(newUser)
  }

  const logout = () => {
    localStorage.removeItem('lic_token')
    localStorage.removeItem('lic_user')
    localStorage.removeItem(CURRENT_POLICY_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }

  return { token, user, saveAuth, logout }
}

function formatTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

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
    Maturity: { label: 'Maturity', description: 'Maturity benefit — policy term completion' },
    Death: { label: 'Death', description: 'Life claim — death benefit for nominees' },
    Surrender: { label: 'Surrender', description: 'Surrender value — early policy closure' },
    Health: { label: 'Health', description: 'Health / medical rider or hospitalization' },
  }
  const key = claimType || ''
  return (
    map[key] || {
      label: key || 'General',
      description: 'Insurance claim submission',
    }
  )
}

function MaterialIcon({ name, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`.trim()}>
      {name}
    </span>
  )
}

function UnifiedLoginPage({ initialMode = 'user', onUserLogin }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState(initialMode) // 'user' | 'admin'

  // Policyholder OTP login
  const [policyNumber, setPolicyNumber] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [mobileFieldError, setMobileFieldError] = useState('')
  const [policyFieldError, setPolicyFieldError] = useState('')

  // Admin login
  const [adminUser, setAdminUser] = useState('')
  const [adminPass, setAdminPass] = useState('')

  const requestOtp = async () => {
    setMobileFieldError('')
    setPolicyFieldError('')
    setError('')
    const pErr = policyNumberFieldError(policyNumber, false)
    if (pErr) {
      setPolicyFieldError(pErr)
      return
    }
    if (!PHONE_REGEX.test(mobileNumber)) {
      setMobileFieldError('Invalid phone number')
      return
    }
    setLoading(true)
    setInfo('')
    try {
      const { data } = await api.post('/auth/request-otp', { policyNumber, mobileNumber })
      setOtpRequested(true)
      setOtp('')
      setInfo(`OTP sent (demo): ${data.otp}`)
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  /** New OTP from server — use after a wrong attempt or when user needs a fresh code */
  const resendOtp = async () => {
    setMobileFieldError('')
    setPolicyFieldError('')
    setError('')
    const pErr = policyNumberFieldError(policyNumber, false)
    if (pErr) {
      setPolicyFieldError(pErr)
      return
    }
    if (!PHONE_REGEX.test(mobileNumber)) {
      setMobileFieldError('Invalid phone number')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/request-otp', { policyNumber, mobileNumber })
      setOtp('')
      setInfo(`New OTP sent (demo): ${data.otp}`)
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
      onUserLogin(data.token, data.user)
      navigate('/chat', { replace: true })
    } catch (e) {
      setError(e.response?.data?.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  const adminLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await adminApi.post('/admin/login', { username: adminUser, password: adminPass })
      localStorage.setItem('lic_admin_token', data.token)
      navigate('/admin/dashboard', { replace: true })
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#f5f7f8] dark:bg-[#0f1a23] font-display text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden">
        <header className="flex items-center justify-between border-b border-[#005299]/10 bg-white/80 dark:bg-[#0f1a23]/80 backdrop-blur-md px-6 py-4 sticky top-0 z-50 lg:px-20">
          <div className="flex items-center gap-3">
            <div className="bg-[#005299] p-2 rounded-lg text-white">
              <MaterialIcon name="shield_with_heart" className="!text-2xl" />
            </div>
            <h1 className="text-[#005299] text-xl font-bold leading-tight tracking-tight">
              LIC AI Claims
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-[#005299] transition-colors">
              <MaterialIcon name="help" className="!text-lg" />
              Support
            </button>
            <div className="h-8 w-[1px] bg-slate-200 dark:bg-slate-700 mx-2 hidden md:block" />
            <button
              onClick={() => document.documentElement.classList.toggle('dark')}
              className="flex items-center justify-center rounded-lg h-10 w-10 bg-[#005299]/10 text-[#005299] hover:bg-[#005299]/20 transition-all"
              title="Toggle dark mode"
            >
              <MaterialIcon name="dark_mode" />
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 relative">
          <div className="absolute inset-0 z-0 opacity-40 pointer-events-none overflow-hidden">
            <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[60%] bg-[#005299]/5 rounded-full blur-3xl" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[60%] bg-[#005299]/5 rounded-full blur-3xl" />
          </div>

          <div className="w-full max-w-[480px] z-10">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="relative h-44 w-full bg-[#005299]/10 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10" />
                <div className="absolute bottom-4 left-6 z-20">
                  <h2 className="text-white text-2xl font-bold">Secure Access</h2>
                  <p className="text-white/80 text-sm">
                    {mode === 'admin' ? 'Admin Portal' : 'Policyholder Portal'}
                  </p>
                </div>
              </div>

              <div className="p-8">
                <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-8">
                  <button
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${mode === 'user'
                        ? 'bg-white dark:bg-slate-700 text-[#005299] shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    type="button"
                    onClick={() => {
                      setMode('user')
                      setError('')
                      setInfo('')
                      setMobileFieldError('')
                      setPolicyFieldError('')
                    }}
                  >
                    <MaterialIcon name="person" className="!text-lg" />
                    Policyholder
                  </button>
                  <button
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${mode === 'admin'
                        ? 'bg-white dark:bg-slate-700 text-[#005299] shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    type="button"
                    onClick={() => {
                      setMode('admin')
                      setError('')
                      setInfo('')
                      setMobileFieldError('')
                      setPolicyFieldError('')
                    }}
                  >
                    <MaterialIcon name="admin_panel_settings" className="!text-lg" />
                    Admin
                  </button>
                </div>

                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Welcome Back
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    {mode === 'admin'
                      ? 'Please sign in to manage claims.'
                      : 'Enter your policy details to manage your claims efficiently.'}
                  </p>
                </div>

                {error && (
                  <div className="mb-4 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg">
                    <p className="font-medium">{error}</p>
                    {mode === 'user' && otpRequested && (
                      <p className="mt-2 text-xs text-red-600/90 dark:text-red-300/90">
                        Your OTP is still shown below. You can edit it or request a new OTP.
                      </p>
                    )}
                  </div>
                )}
                {info && (
                  <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-lg">
                    {info}
                  </div>
                )}

                {mode === 'user' ? (
                  <form
                    className="space-y-6"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!otpRequested) void requestOtp()
                    }}
                  >
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Policy Number
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <MaterialIcon name="article" className="text-slate-400 !text-xl" />
                        </div>
                        <input
                          className={`block w-full pl-10 pr-4 py-3 border rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 transition-all outline-none ${
                            policyFieldError
                              ? 'border-red-500 focus:ring-red-500/30 focus:border-red-500'
                              : 'border-slate-200 dark:border-slate-700 focus:ring-[#005299]/20 focus:border-[#005299]'
                          }`}
                          placeholder="6–10 digit policy number"
                          inputMode="numeric"
                          autoComplete="off"
                          value={policyNumber}
                          onChange={(e) => {
                            const raw = e.target.value
                            const hadNonDigit = /[^0-9]/.test(raw)
                            const d = sanitizePolicyDigits(raw)
                            setPolicyNumber(d)
                            setPolicyFieldError(policyNumberFieldError(d, hadNonDigit))
                          }}
                          aria-invalid={policyFieldError ? true : undefined}
                          aria-describedby="policyholder-policy-error"
                        />
                      </div>
                      {policyFieldError && (
                        <p
                          id="policyholder-policy-error"
                          className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                          role="alert"
                        >
                          {policyFieldError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Registered Mobile Number
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <MaterialIcon name="call" className="text-slate-400 !text-xl" />
                        </div>
                        <input
                          className={`block w-full pl-10 pr-4 py-3 border rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 transition-all outline-none ${
                            mobileFieldError
                              ? 'border-red-500 focus:ring-red-500/30 focus:border-red-500'
                              : 'border-slate-200 dark:border-slate-700 focus:ring-[#005299]/20 focus:border-[#005299]'
                          }`}
                          placeholder="10-digit mobile number"
                          inputMode="numeric"
                          autoComplete="tel"
                          maxLength={10}
                          value={mobileNumber}
                          onChange={(e) => {
                            const v = sanitizePhoneDigits(e.target.value)
                            setMobileNumber(v)
                            setMobileFieldError(mobileValidationMessage(v))
                          }}
                          aria-invalid={mobileFieldError ? true : undefined}
                          aria-describedby="policyholder-mobile-error"
                        />
                      </div>
                      {mobileFieldError && (
                        <p
                          id="policyholder-mobile-error"
                          className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                          role="alert"
                        >
                          {mobileFieldError}
                        </p>
                      )}
                    </div>

                    {otpRequested && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                          OTP
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <MaterialIcon name="lock" className="text-slate-400 !text-xl" />
                          </div>
                          <input
                            className={`block w-full pl-10 pr-4 py-3 border rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 transition-all outline-none ${
                              error && otpRequested
                                ? 'border-red-500 focus:ring-red-500/30 focus:border-red-500'
                                : 'border-slate-200 dark:border-slate-700 focus:ring-[#005299]/20 focus:border-[#005299]'
                            }`}
                            placeholder="Enter OTP"
                            value={otp}
                            onChange={(e) => {
                              setOtp(e.target.value)
                              setError('')
                            }}
                            aria-invalid={error && otpRequested ? true : undefined}
                          />
                        </div>
                      </div>
                    )}

                    {!otpRequested ? (
                      <button
                        type="submit"
                        disabled={
                          loading ||
                          !POLICY_NUMBER_REGEX.test(policyNumber) ||
                          !PHONE_REGEX.test(mobileNumber)
                        }
                        className="w-full bg-[#005299] text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-[#005299]/90 transition-all shadow-lg disabled:opacity-60"
                      >
                        <MaterialIcon name="verified_user" className="!text-xl" />
                        {loading ? 'Sending OTP...' : 'Request OTP'}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={verifyOtp}
                          disabled={loading}
                          className="w-full bg-[#005299] text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-[#005299]/90 transition-all shadow-lg disabled:opacity-60"
                        >
                          <MaterialIcon name="lock_open" className="!text-xl" />
                          {loading ? 'Verifying...' : 'Verify & Login'}
                        </button>
                        <button
                          type="button"
                          onClick={resendOtp}
                          disabled={loading}
                          className="w-full py-2.5 text-sm font-semibold text-[#005299] dark:text-sky-400 border border-[#005299]/30 dark:border-sky-500/30 rounded-lg hover:bg-[#005299]/5 dark:hover:bg-sky-500/10 transition-colors disabled:opacity-60"
                        >
                          <span className="inline-flex items-center justify-center gap-2">
                            <MaterialIcon name="sms" className="!text-lg" />
                            Resend OTP (new code)
                          </span>
                        </button>
                      </div>
                    )}
                  </form>
                ) : (
                  <form className="space-y-6" onSubmit={adminLogin}>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Admin Username
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <MaterialIcon name="admin_panel_settings" className="text-slate-400 !text-xl" />
                        </div>
                        <input
                          className="block w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#005299]/20 focus:border-[#005299] transition-all outline-none"
                          placeholder="Username"
                          value={adminUser}
                          onChange={(e) => setAdminUser(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Password
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <MaterialIcon name="lock" className="text-slate-400 !text-xl" />
                        </div>
                        <input
                          type="password"
                          className="block w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#005299]/20 focus:border-[#005299] transition-all outline-none"
                          placeholder="••••••••"
                          value={adminPass}
                          onChange={(e) => setAdminPass(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#005299] text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-[#005299]/90 transition-all shadow-lg disabled:opacity-60"
                    >
                      <MaterialIcon name="verified_user" className="!text-xl" />
                      {loading ? 'Signing in...' : 'Secure Admin Login'}
                    </button>
                  </form>
                )}

                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                    <MaterialIcon name="lock" className="!text-[14px]" />
                    End-to-End Encrypted
                  </div>
                </div>
              </div>
            </div>

            <footer className="mt-8 text-center space-y-4">
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto leading-relaxed">
                LIC uses AI-assisted flows to guide claim filing and status tracking.
              </p>
              <div className="flex justify-center gap-6">
                <a className="text-xs text-slate-400 hover:text-[#005299] transition-colors" href="#">
                  Privacy Policy
                </a>
                <a className="text-xs text-slate-400 hover:text-[#005299] transition-colors" href="#">
                  Terms of Use
                </a>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}

function UserSidebar({ user, onLogout }) {
  const location = useLocation()
  const navItems = [
    { to: '/chat', label: 'Recent Chats', icon: 'chat_bubble' },
    { to: '/claims/status', label: 'Track Claim', icon: 'track_changes' },
    { to: '/documents', label: 'My Documents', icon: 'description' },
    { to: '/support', label: 'Customer Support', icon: 'contact_support' },
  ]

  return (
    <aside className="flex h-full w-80 flex-col border-r border-[#005299]/10 bg-white dark:bg-[#0f1a23]/50 shadow-sm">
      <div className="flex flex-col h-full p-4 gap-6">
        <div className="flex items-center gap-3 px-2">
          <div className="bg-[#005299]/10 rounded-full p-2 flex items-center justify-center">
            <MaterialIcon name="shield_person" className="text-[#005299] text-2xl" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[#005299] text-base font-bold leading-none">LIC AI Claims</h1>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium">
              Claims Assistant
            </p>
          </div>
        </div>

        <Link
          to="/claims/new"
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#005299] py-3 text-white text-sm font-bold transition-all hover:bg-[#005299]/90"
        >
          <MaterialIcon name="add" className="text-sm" />
          <span>New Claim</span>
        </Link>

        <nav className="flex flex-col gap-1">
          {navItems.map((it) => {
            const active = location.pathname === it.to
            return (
              <Link
                key={it.to}
                to={it.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${active
                    ? 'bg-[#005299]/10 text-[#005299]'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
              >
                <MaterialIcon name={it.icon} className="text-xl" />
                <p className={`${active ? 'font-semibold' : 'font-medium'} text-sm`}>
                  {it.label}
                </p>
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-[#005299]/5">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
              <MaterialIcon name="person" className="text-slate-500 dark:text-slate-200" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <p className="text-sm font-bold truncate">{user?.policyNumber || 'Policyholder'}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Member</p>
            </div>
            <button
              className="ml-auto text-slate-400 hover:text-[#005299]"
              title="Logout"
              onClick={(e) => {
                e.preventDefault()
                onLogout()
              }}
            >
              <MaterialIcon name="logout" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MyDocumentsModal({ isOpen, onClose, onSelect, policyNumber }) {
  const [docs, setDocs] = useState([])

  useEffect(() => {
    if (!isOpen) {
      setDocs([])
      return
    }
    const p = String(policyNumber || '').trim()
    setDocs(p ? getDocumentsForPolicy(p) : [])
  }, [isOpen, policyNumber])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <h3 className="font-bold">Select from My Documents</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <MaterialIcon name="close" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {docs.length === 0 ? (
            <p className="text-center py-8 text-slate-500 text-sm">No documents found in My Documents.</p>
          ) : (
            docs.map((d) => (
              <div
                key={d.id}
                onClick={() => onSelect(d)}
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[#005299]/50 hover:bg-[#005299]/5 cursor-pointer transition-colors"
              >
                <div className="size-10 rounded-lg bg-[#005299]/10 flex items-center justify-center text-[#005299]">
                  <MaterialIcon name="description" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.size} • Uploaded {new Date(d.date).toLocaleDateString()}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ChatbotAssistantPage({ user }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  const suggestions = useMemo(
    () => [
      { icon: 'help', text: 'How to file a claim?' },
      { icon: 'description', text: 'Missing documents list' },
      { icon: 'contact_support', text: 'Talk to an agent' },
    ],
    []
  )

  useEffect(() => {
    const load = async () => {
      const { data } = await api.get('/chatbot/history')
      setMessages(data)
    }
    load().catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const [attachedFile, setAttachedFile] = useState(null)
  const fileInputRef = useRef(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  const handleLocalFile = (e) => {
    const file = e.target.files?.[0]
    if (file) setAttachedFile(file)
  }

  const handleSelectFromDocs = (doc) => {
    const file = fileFromStoredDocument(doc)
    if (file) setAttachedFile(file)
    setShowDocModal(false)
  }

  const send = async (text) => {
    const trimmed = text.trim()
    if (!trimmed && !attachedFile) return
    setSending(true)
    try {
      const formData = new FormData()
      formData.append('message', trimmed || 'Analyze this document')
      if (attachedFile) {
        formData.append('file', attachedFile)
      }

      const { data } = await api.post('/chatbot/message', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMessages((prev) => [...prev, data.user, data.bot])
      setInput('')
      setAttachedFile(null)
    } catch (err) {
      console.error(err)
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-white dark:bg-[#0f1a23] relative">
      <header className="flex items-center justify-between border-b border-[#005299]/10 bg-white/80 dark:bg-[#0f1a23]/80 backdrop-blur-md px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-[#005299]/10 flex items-center justify-center">
              <MaterialIcon name="smart_toy" className="text-[#005299]" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-[#0f1a23] rounded-full" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-slate-900 dark:text-slate-100 text-base font-bold leading-tight">
              LIC AI Assistant
            </h2>
            <p className="text-green-600 dark:text-green-500 text-xs font-medium">
              Online • Active now
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors">
            <MaterialIcon name="call" />
          </button>
          <button className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors">
            <MaterialIcon name="videocam" />
          </button>
          <button
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
            onClick={() => document.documentElement.classList.toggle('dark')}
            title="Toggle dark mode"
          >
            <MaterialIcon name="dark_mode" />
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 bg-slate-50 dark:bg-[#0f1a23]/30"
      >
        {messages.length === 0 && (
          <div className="flex items-end gap-3 max-w-[80%]">
            <div className="w-8 h-8 rounded-full bg-[#005299]/10 flex items-center justify-center shrink-0">
              <MaterialIcon name="smart_toy" className="text-[#005299] text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="rounded-2xl rounded-bl-none px-4 py-3 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm border border-[#005299]/5">
                <p className="text-sm leading-relaxed">
                  Namaste! I am your LIC AI Assistant. I can help you file new claims, track
                  existing ones, or answer policy-related questions. How can I assist you today?
                </p>
              </div>
              <span className="text-[10px] text-slate-400 ml-1">
                {formatTime(new Date().toISOString())}
              </span>
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.sender === 'user' ? (
            <div key={m._id} className="flex items-end gap-3 justify-end self-end max-w-[80%]">
              <div className="flex flex-col gap-1 items-end">
                <div className="rounded-2xl rounded-br-none px-4 py-3 bg-[#005299] text-white shadow-md">
                  <p className="text-sm leading-relaxed">{m.message}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400">{formatTime(m.createdAt)}</span>
                  <MaterialIcon name="done_all" className="text-[14px] text-[#005299]" />
                </div>
              </div>
            </div>
          ) : (
            <div key={m._id} className="flex items-end gap-3 max-w-[80%]">
              <div className="w-8 h-8 rounded-full bg-[#005299]/10 flex items-center justify-center shrink-0">
                <MaterialIcon name="smart_toy" className="text-[#005299] text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <div className="rounded-2xl rounded-bl-none px-4 py-3 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm border border-[#005299]/5">
                  <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-inherit">
                    <ReactMarkdown>{m.message}</ReactMarkdown>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 ml-1">{formatTime(m.createdAt)}</span>
              </div>
            </div>
          )
        )}

        <div className="flex flex-wrap gap-2 mt-2 pb-4">
          {suggestions.map((s) => (
            <button
              key={s.text}
              onClick={() => send(s.text)}
              className="flex h-9 items-center justify-center gap-2 rounded-full border border-[#005299]/20 bg-white dark:bg-slate-800 px-4 text-xs font-semibold text-[#005299] hover:bg-[#005299]/5 transition-colors"
            >
              <MaterialIcon name={s.icon} className="text-sm" />
              {s.text}
            </button>
          ))}
        </div>
      </div>

      <footer className="p-4 bg-white dark:bg-[#0f1a23] border-t border-[#005299]/10">
        {attachedFile && (
          <div className="mb-3 flex items-center gap-2 p-2 bg-[#005299]/5 rounded-lg border border-[#005299]/10">
            <MaterialIcon name="description" className="text-[#005299]" />
            <span className="text-xs font-medium flex-1 truncate">{attachedFile.name}</span>
            <button 
              onClick={() => setAttachedFile(null)}
              className="p-1 hover:bg-red-100 text-red-500 rounded transition-colors"
            >
              <MaterialIcon name="close" className="!text-lg" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2">
          <button className="text-slate-500 hover:text-[#005299] transition-colors" title="Emoji">
            <MaterialIcon name="mood" />
          </button>
          <div className="relative">
            <button 
              type="button"
              className="text-slate-500 hover:text-[#005299] transition-colors" 
              title="Attach"
              onClick={() => setShowAttachMenu(!showAttachMenu)}
            >
              <MaterialIcon name="attach_file" />
            </button>
            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-2 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
                <button 
                  onClick={() => {
                    fileInputRef.current?.click()
                    setShowAttachMenu(false)
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                >
                  <MaterialIcon name="upload_file" className="!text-base" />
                  Upload Local File
                </button>
                <button 
                  onClick={() => {
                    setShowDocModal(true)
                    setShowAttachMenu(false)
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                >
                  <MaterialIcon name="folder_shared" className="!text-base" />
                  Select from My Docs
                </button>
              </div>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleLocalFile}
            accept=".pdf,.jpg,.jpeg,.png"
          />

          <input
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 py-2"
            placeholder={attachedFile ? "Ask a question about this file..." : "Type your message here..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !sending && send(input)}
          />
          <button className="text-slate-500 hover:text-[#005299] transition-colors px-2" title="Mic">
            <MaterialIcon name="mic" />
          </button>
          <button
            onClick={() => send(input)}
            disabled={sending}
            className="flex items-center justify-center bg-[#005299] text-white w-10 h-10 rounded-lg hover:bg-[#005299]/90 shadow-md transition-all active:scale-95 disabled:opacity-60"
            title="Send"
          >
            <MaterialIcon name="send" />
          </button>
        </div>
        <div className="flex justify-center mt-2">
          <p className="text-[10px] text-slate-400">Secure claim filing system</p>
        </div>
      </footer>
      <MyDocumentsModal
        isOpen={showDocModal}
        onClose={() => setShowDocModal(false)}
        onSelect={handleSelectFromDocs}
        policyNumber={user?.policyNumber}
      />
    </main>
  )
}

/** Policy number: 6–10 digits, numeric only (trimmed). */
const POLICY_NUMBER_REGEX = /^[0-9]{6,10}$/

function sanitizePolicyDigits(value) {
  return String(value).replace(/\D/g, '').slice(0, 10)
}

/**
 * Real-time policy validation. `digits` = sanitized; `inputHadNonDigit` if raw input contained non-numeric chars.
 */
function policyNumberFieldError(digits, inputHadNonDigit) {
  const t = String(digits).trim()
  if (POLICY_NUMBER_REGEX.test(t)) return ''
  if (t.length === 0) return 'Policy number is required'
  if (inputHadNonDigit) return 'Policy number must contain only numbers'
  if (t.length < 6) return 'Policy number must be at least 6 digits'
  if (t.length > 10) return 'Policy number must not exceed 10 digits'
  return ''
}

/** Policyholder login: registered mobile must be exactly 10 digits (0–9). */
const PHONE_REGEX = /^[0-9]{10}$/

function sanitizePhoneDigits(value) {
  return String(value).replace(/\D/g, '').slice(0, 10)
}

function mobileValidationMessage(digits) {
  if (digits.length === 0) return ''
  return PHONE_REGEX.test(digits) ? '' : 'Invalid phone number'
}

/** New Claim — Step 2: four fields, 25% each (Policy #, Claim type, Name, Reason). */
function getClaimDetailsProgressPercent(form) {
  let filled = 0
  if (POLICY_NUMBER_REGEX.test(String(form.policyNumber || '').trim())) filled += 1
  if (form.claimType) filled += 1
  if ((form.policyholderName || '').trim()) filled += 1
  if ((form.reason || '').trim()) filled += 1
  return filled * 25
}

function isClaimDetailsComplete(form) {
  return getClaimDetailsProgressPercent(form) === 100
}

function ClaimSubmitPage({ user }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(() => ({
    policyNumber: sanitizePolicyDigits(user?.policyNumber || ''),
    policyholderName: '',
    claimType: '',
    reason: '',
  }))
  const [claimPolicyError, setClaimPolicyError] = useState(() =>
    policyNumberFieldError(sanitizePolicyDigits(user?.policyNumber || ''), false)
  )
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showValidation, setShowValidation] = useState(false)

  const [showDocPicker, setShowDocPicker] = useState(false)
  const [docPickerDocs, setDocPickerDocs] = useState([])

  const fileInputRef = useRef(null)

  const claimPolicyKey = String(user?.policyNumber || '').trim()

  useEffect(() => {
    if (!showDocPicker) {
      setDocPickerDocs([])
      return
    }
    setDocPickerDocs(claimPolicyKey ? getDocumentsForPolicy(claimPolicyKey) : [])
  }, [showDocPicker, claimPolicyKey])

  const progressPercent = useMemo(() => getClaimDetailsProgressPercent(form), [form])
  const detailsComplete = progressPercent === 100

  useEffect(() => {
    if (detailsComplete && showValidation) setShowValidation(false)
  }, [detailsComplete, showValidation])

  const invalidPolicy = Boolean(claimPolicyError)
  const invalidClaimType = showValidation && !form.claimType
  const invalidName = showValidation && !form.policyholderName.trim()
  const invalidReason = showValidation && !form.reason.trim()

  const fieldBorderClass = (invalid) =>
    invalid
      ? 'border-red-500 dark:border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30 ring-1 ring-red-500/40'
      : 'border-slate-300 dark:border-slate-700 focus:border-[#005299] focus:ring-2 focus:ring-[#005299]/20'

  const submit = async (e) => {
    e.preventDefault()
    if (!isClaimDetailsComplete(form)) {
      setShowValidation(true)
      setClaimPolicyError(policyNumberFieldError(form.policyNumber, false))
      return
    }
    setShowValidation(false)
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      files.forEach((f) => fd.append('documents', f))
      await api.post('/claims', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setSuccess('Claim submitted successfully. Status: Pending.')
      setForm((p) => ({ ...p, claimType: '', reason: '' }))
      setFiles([])
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#f5f7f8] dark:bg-[#0f1a23] font-display text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
        <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#005299]/10 bg-white dark:bg-[#0f1a23] px-6 md:px-10 py-3 sticky top-0 z-50">
          <div className="flex items-center gap-4 text-[#005299]">
            <div className="size-8">
              <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M24 4C25.7818 14.2173 33.7827 22.2182 44 24C33.7827 25.7818 25.7818 33.7827 24 44C22.2182 33.7827 14.2173 25.7818 4 24C14.2173 22.2182 22.2182 14.2173 24 4Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <h2 className="text-slate-900 dark:text-slate-100 text-xl font-bold leading-tight tracking-[-0.015em]">
              LIC Digital
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/chat')}
              className="flex items-center gap-2 rounded-lg bg-[#005299]/10 text-[#005299] hover:bg-[#005299]/20 transition-colors px-3 py-2 text-sm font-semibold"
            >
              <MaterialIcon name="arrow_back" />
              Back
            </button>
            <button
              onClick={() => document.documentElement.classList.toggle('dark')}
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg bg-[#005299]/10 text-[#005299] hover:bg-[#005299]/20 transition-colors"
              title="Toggle dark mode"
            >
              <MaterialIcon name="dark_mode" />
            </button>
          </div>
        </header>

        <main className="flex flex-1 justify-center py-8 px-4 md:px-0">
          <div className="flex flex-col max-w-[800px] flex-1">
            <div className="mb-8">
              <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-bold mb-2">
                Submit Your Claim
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                Complete the details below to initiate your policy claim processing.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex gap-6 justify-between items-end">
                  <span className="text-[#005299] font-semibold text-sm">
                    Step {progressPercent < 100 ? '2 of 4: Claim Details' : 'Final Step: Ready to Submit'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                    {progressPercent}% Complete
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#005299]/10 overflow-hidden">
                  <div
                    className="claim-progress-bar-fill h-full bg-[#005299] rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-4 py-3 text-sm">
                {success}
              </div>
            )}

            <form
              onSubmit={submit}
              noValidate
              className="space-y-8 bg-white dark:bg-slate-900 p-6 md:p-10 rounded-xl shadow-sm border border-[#005299]/5"
            >
              <section className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-[#005299]/10">
                  <MaterialIcon name="description" className="text-[#005299]" />
                  <h3 className="text-lg font-bold">Policy Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Policy Number
                    </label>
                    <input
                      className={`rounded-lg border bg-transparent h-11 px-4 text-sm ${fieldBorderClass(invalidPolicy)}`}
                      placeholder="6–10 digit policy number"
                      inputMode="numeric"
                      value={form.policyNumber}
                      onChange={(e) => {
                        const raw = e.target.value
                        const hadNonDigit = /[^0-9]/.test(raw)
                        const d = sanitizePolicyDigits(raw)
                        setForm((p) => ({ ...p, policyNumber: d }))
                        setClaimPolicyError(policyNumberFieldError(d, hadNonDigit))
                      }}
                      type="text"
                      aria-invalid={invalidPolicy ? true : undefined}
                      aria-describedby="claim-policy-error"
                    />
                    {claimPolicyError ? (
                      <p
                        id="claim-policy-error"
                        className="text-sm text-red-600 dark:text-red-400"
                        role="alert"
                      >
                        {claimPolicyError}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-500">Enter the number from your policy bond.</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Claim Type
                    </label>
                    <select
                      className={`rounded-lg border bg-transparent h-11 px-4 text-sm ${fieldBorderClass(invalidClaimType)}`}
                      value={form.claimType}
                      onChange={(e) => setForm((p) => ({ ...p, claimType: e.target.value }))}
                    >
                      <option value="">Select Claim Type</option>
                      <option value="Maturity">Maturity Claim</option>
                      <option value="Death">Death Claim</option>
                      <option value="Surrender">Surrender Claim</option>
                      <option value="Health">Health Claim</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Policyholder Name
                    </label>
                    <input
                      className={`rounded-lg border bg-transparent h-11 px-4 text-sm ${fieldBorderClass(invalidName)}`}
                      placeholder="Full name as per policy"
                      value={form.policyholderName}
                      onChange={(e) => setForm((p) => ({ ...p, policyholderName: e.target.value }))}
                      type="text"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-[#005299]/10">
                  <MaterialIcon name="event_note" className="text-[#005299]" />
                  <h3 className="text-lg font-bold">Claim Details</h3>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Reason / Description
                  </label>
                  <textarea
                    className={`rounded-lg border bg-transparent px-4 py-3 text-sm min-h-[110px] ${fieldBorderClass(invalidReason)}`}
                    placeholder="Describe the reason for the claim..."
                    value={form.reason}
                    onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  />
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-[#005299]/10">
                  <MaterialIcon name="upload_file" className="text-[#005299]" />
                  <h3 className="text-lg font-bold">Document Upload</h3>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[#005299]/20 rounded-xl p-6 text-center flex flex-col items-center justify-center gap-2 bg-[#005299]/5 hover:bg-[#005299]/10 transition-colors cursor-pointer"
                  >
                    <MaterialIcon name="cloud_upload" className="text-3xl text-[#005299]/60" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-bold">Local Upload</p>
                      <p className="text-[10px] text-slate-500">PDF, JPG, PNG</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDocPicker(true)}
                    className="border-2 border-dashed border-emerald-500/20 rounded-xl p-6 text-center flex flex-col items-center justify-center gap-2 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                  >
                    <MaterialIcon name="folder_shared" className="text-3xl text-emerald-500/60" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-bold">My Documents</p>
                      <p className="text-[10px] text-slate-500">Select saved files</p>
                    </div>
                  </button>
                </div>

                {showDocPicker && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                        <h3 className="font-bold">Select from My Documents</h3>
                        <button onClick={() => setShowDocPicker(false)} className="text-slate-400 hover:text-slate-600">
                          <MaterialIcon name="close" />
                        </button>
                      </div>
                      <div className="p-4 overflow-y-auto flex-1 space-y-2">
                        {docPickerDocs.length === 0 ? (
                          <p className="text-center py-8 text-slate-500 text-sm">No documents found in My Documents.</p>
                        ) : (
                          docPickerDocs.map((d) => {
                            const selected = files.some((f) => f.name === d.name)
                            return (
                              <div 
                                key={d.id} 
                                onClick={() => {
                                  if (selected) {
                                    setFiles((prev) => prev.filter((f) => f.name !== d.name))
                                  } else {
                                    const file = fileFromStoredDocument(d)
                                    if (file) setFiles((prev) => [...prev, file])
                                  }
                                }}
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                  selected 
                                    ? 'border-[#005299] bg-[#005299]/5' 
                                    : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <MaterialIcon name="description" className={selected ? 'text-[#005299]' : 'text-slate-400'} />
                                  <div className="flex flex-col">
                                    <span className="text-xs font-semibold">{d.name}</span>
                                    <span className="text-[10px] text-slate-500">{d.size}</span>
                                  </div>
                                </div>
                                {selected && <MaterialIcon name="check_circle" className="text-[#005299] !text-xl" />}
                              </div>
                            )
                          })
                        )}
                      </div>
                      <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <button 
                          onClick={() => setShowDocPicker(false)}
                          className="w-full py-2.5 bg-[#005299] text-white rounded-lg font-bold shadow-md hover:brightness-110"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {files.length > 0 && (
                  <div className="grid grid-cols-1 gap-3">
                    {files.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
                      >
                        <div className="flex items-center gap-3">
                          <MaterialIcon name="description" className="text-[#005299]" />
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold">{f.name}</span>
                            <span className="text-[10px] text-slate-500">
                              {(f.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="text-slate-400 hover:text-red-500"
                          onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                        >
                          <MaterialIcon name="delete" className="text-lg" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="pt-8 flex flex-col sm:flex-row gap-4 justify-between items-center border-t border-slate-100 dark:border-slate-800">
                <button
                  className="w-full sm:w-auto px-8 h-12 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  type="button"
                  onClick={() => setSuccess('Draft saved locally (demo).')}
                >
                  Save Draft
                </button>
                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                  <button
                    className="w-full sm:w-auto px-10 h-12 rounded-lg bg-[#005299] text-white font-bold shadow-lg hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                    type="submit"
                    title={!detailsComplete ? 'Complete all claim detail fields to submit' : undefined}
                    disabled={loading || !detailsComplete}
                  >
                    {loading ? 'Submitting...' : 'Submit Claim'}
                    <MaterialIcon name="arrow_forward" className="text-lg" />
                  </button>
                </div>
              </div>
            </form>

            <div className="mt-8 flex flex-col md:flex-row justify-between items-center gap-4 px-4">
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <MaterialIcon name="verified_user" className="text-sm" />
                Your data is encrypted and secure
              </div>
              <div className="flex gap-6 text-sm font-medium text-[#005299]">
                <a className="hover:underline" href="#">
                  Need Help?
                </a>
                <Link className="hover:underline" to="/claims/status">
                  Claim Status
                </Link>
                <a className="hover:underline" href="#">
                  FAQs
                </a>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function ClaimStatusPage() {
  const [policyNumber, setPolicyNumber] = useState('')
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = localStorage.getItem('lic_user')
    if (raw) {
      const u = JSON.parse(raw)
      setPolicyNumber(u.policyNumber || '')
    }
  }, [])

  const fetchClaims = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/claims', { params: policyNumber ? { policyNumber } : {} })
      setClaims(data)
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (policyNumber) fetchClaims()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyNumber])

  return (
    <div className="p-8">
      <div className="max-w-3xl space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-[#005299]/10 p-6">
          <h2 className="text-xl font-bold">Track Claim</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Enter your policy number to view submitted claims and current status.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:border-[#005299] focus:ring-2 focus:ring-[#005299]/20 h-11 px-4 text-sm"
              placeholder="Policy number"
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
            />
            <button
              onClick={fetchClaims}
              disabled={loading}
              className="h-11 px-5 rounded-lg bg-[#005299] text-white font-bold shadow-md hover:bg-[#005299]/90 transition-colors disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Check'}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
        </div>

        <div className="grid gap-4">
          {claims.map((c) => (
            <div
              key={c._id}
              className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-[#005299]/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {c.claimType} Claim • <span className="text-slate-400">#{c._id.slice(-6)}</span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">{c.reason}</p>
                <p className="text-[11px] text-slate-400">
                  Submitted {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${c.status === 'Approved'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : c.status === 'Rejected'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}
                >
                  {c.status}
                </span>
              </div>
            </div>
          ))}
          {claims.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No claims found for this policy.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function MyDocumentsPage({ user }) {
  const policy = String(user?.policyNumber || '').trim()
  const [docs, setDocs] = useState(() => getDocumentsForPolicy(policy))
  const [uploadNotice, setUploadNotice] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    setDocs(policy ? getDocumentsForPolicy(policy) : [])
    setUploadNotice('')
    setUploadError('')
  }, [policy])

  const refreshDocs = () => setDocs(policy ? getDocumentsForPolicy(policy) : [])

  const upload = async (e) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    setUploadError('')
    setUploadNotice('')

    if (!policy) {
      setUploadError('You must be logged in with a policy number to save documents.')
      e.target.value = ''
      return
    }

    const accepted = Array.from(fileList).filter((f) => isAllowedMyDocumentFile(f))
    const rejected = Array.from(fileList).length - accepted.length
    if (accepted.length === 0) {
      setUploadError('Only PDF, JPG, and PNG files are allowed.')
      e.target.value = ''
      return
    }

    const results = await Promise.all(
      accepted.map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = (ev) => {
              resolve({
                name: f.name,
                size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
                date: new Date().toISOString(),
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                type: f.type,
                data: ev.target.result,
              })
            }
            reader.readAsDataURL(f)
          })
      )
    )

    appendDocumentsForPolicy(policy, results)
    refreshDocs()
    e.target.value = ''
    const msg = `${results.length} file(s) saved for policy ${policy}.`
    setUploadNotice(rejected > 0 ? `${msg} (${rejected} skipped — invalid type.)` : msg)
  }

  const deleteDoc = (id) => {
    if (!policy) return
    removeDocumentByIdForPolicy(policy, id)
    refreshDocs()
  }

  return (
    <div className="p-8 w-full max-w-4xl mx-auto">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-[#005299]/10 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">My Documents</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Securely store and manage your medical reports and policy documents.
            </p>
          </div>
          <button 
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#005299] text-white rounded-lg font-bold hover:brightness-110 transition-all"
          >
            <MaterialIcon name="add" />
            Add Document
          </button>
          <input
            type="file"
            ref={fileRef}
            className="hidden"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={upload}
          />
        </div>

        {!policy && (
          <p className="mb-4 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg">
            Sign in with your policy number to view and upload documents.
          </p>
        )}
        {uploadError && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {uploadError}
          </p>
        )}
        {uploadNotice && (
          <p className="mb-4 text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-lg">
            {uploadNotice}
          </p>
        )}

        <div className="grid gap-4">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 hover:border-[#005299]/30 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-lg bg-[#005299]/10 flex items-center justify-center text-[#005299]">
                  <MaterialIcon name="description" className="!text-2xl" />
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.size} • Added {new Date(d.date).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  onClick={() => deleteDoc(d.id)}
                  title="Delete"
                >
                  <MaterialIcon name="delete" />
                </button>
              </div>
            </div>
          ))}
          {docs.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center justify-center gap-4">
              <div className="size-20 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
                <MaterialIcon name="folder_open" className="!text-5xl" />
              </div>
              <p className="text-slate-500 font-medium">No documents saved yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CustomerSupportPage() {
  return (
    <div className="p-8 w-full max-w-4xl mx-auto">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-[#005299]/10 p-10 overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <MaterialIcon name="contact_support" className="!text-[120px] text-[#005299]" />
        </div>
        
        <div className="relative z-10">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Customer Support</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-lg">
            Our support team is here to help you with any questions or issues regarding your claims and policies.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-[#005299]/5 rounded-2xl border border-[#005299]/10">
              <div className="size-12 bg-[#005299] text-white rounded-xl flex items-center justify-center mb-4">
                <MaterialIcon name="call" />
              </div>
              <h3 className="font-bold text-lg mb-1">Call Us</h3>
              <p className="text-sm text-slate-500 mb-4">Available 24/7 for urgent assistance.</p>
              <p className="text-2xl font-bold text-[#005299]">+1-800-LIC-HELP</p>
            </div>

            <div className="p-6 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
              <div className="size-12 bg-emerald-500 text-white rounded-xl flex items-center justify-center mb-4">
                <MaterialIcon name="mail" />
              </div>
              <h3 className="font-bold text-lg mb-1">Email Support</h3>
              <p className="text-sm text-slate-500 mb-4">Get a response within 24 hours.</p>
              <p className="text-xl font-bold text-emerald-600">support@licdigital.com</p>
            </div>
          </div>

          <div className="mt-10 pt-10 border-t border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-lg mb-4">Frequently Asked Questions</h3>
            <div className="space-y-4">
              {[
                { q: "How long does claim processing take?", a: "Typically, claims are processed within 7-10 business days after all documents are verified." },
                { q: "What documents are required for a health claim?", a: "Minimum requirements include medical reports, hospital bills, and identity proof." }
              ].map((faq, i) => (
                <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <p className="font-bold text-sm mb-1">{faq.q}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function UserShell({ user, onLogout }) {
  return (
    <div className="bg-[#f5f7f8] dark:bg-[#0f1a23] text-slate-900 dark:text-slate-100 font-display">
      <div className="relative flex h-screen w-full overflow-hidden">
        <UserSidebar user={user} onLogout={onLogout} />
        <Routes>
          <Route path="/chat" element={<ChatbotAssistantPage user={user} />} />
          <Route path="/claims/status" element={<ClaimStatusPage />} />
          <Route path="/documents" element={<MyDocumentsPage user={user} />} />
          <Route path="/support" element={<CustomerSupportPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function RequireAdmin({ children }) {
  const token = localStorage.getItem('lic_admin_token')
  const location = useLocation()
  if (!token) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  return children
}

function AdminLayout({ children }) {
  return (
    <div className="bg-[#f5f7f8] dark:bg-[#0f1a23] text-slate-900 dark:text-slate-100 font-display">
      <div className="flex h-screen overflow-hidden">
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="p-6 flex items-center gap-3">
            <div className="size-10 bg-[#005299] rounded-lg flex items-center justify-center text-white">
              <MaterialIcon name="shield" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">InsureAdmin</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Claims Management</p>
            </div>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            <Link
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#005299] text-white"
              to="/admin/dashboard"
            >
              <MaterialIcon name="dashboard" />
              <span className="text-sm font-medium">Dashboard</span>
            </Link>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              onClick={() => {
                localStorage.removeItem('lic_admin_token')
                window.location.href = '/admin/login'
              }}
            >
              <MaterialIcon name="logout" />
              <span className="text-sm font-medium">Logout</span>
            </button>
          </nav>
          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Secure admin environment
            </p>
          </div>
        </aside>
        <main className="flex-1 flex flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

function AdminDashboardPage() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailClaim, setDetailClaim] = useState(null)

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
    } catch (e) {
      let msg = 'Could not download file'
      const data = e.response?.data
      if (data instanceof Blob) {
        try {
          const text = await data.text()
          const j = JSON.parse(text)
          if (j.message) msg = j.message
        } catch {
          /* ignore */
        }
      } else if (e.response?.data?.message) {
        msg = e.response.data.message
      }
      setError(msg)
    }
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await adminApi.get('/admin/claims')
      setClaims(data)
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const stats = useMemo(() => {
    const total = claims.length
    const pending = claims.filter((c) => c.status === 'Pending').length
    const approved = claims.filter((c) => c.status === 'Approved').length
    return { total, pending, approved }
  }, [claims])

  const updateStatus = async (id, status) => {
    try {
      await adminApi.put(`/admin/claims/${id}`, { status })
      await load()
    } catch (e) {
      setError(e.response?.data?.message || e.message)
    }
  }

  const recent = claims.slice(0, 12)

  return (
    <>
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
        <h2 className="text-xl font-bold">Claims Overview</h2>
        <div className="flex items-center gap-3">
          <button
            className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium"
            onClick={load}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            onClick={() => document.documentElement.classList.toggle('dark')}
            title="Toggle dark mode"
          >
            <MaterialIcon name="dark_mode" />
          </button>
        </div>
      </header>

      <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                Total Claims
              </span>
              <div className="size-10 rounded-lg bg-[#005299]/10 text-[#005299] flex items-center justify-center">
                <MaterialIcon name="folder" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold">{stats.total}</h3>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                Pending
              </span>
              <div className="size-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <MaterialIcon name="pending_actions" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold">{stats.pending}</h3>
              <span className="text-slate-500 text-sm font-medium">In Queue</span>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                Approved
              </span>
              <div className="size-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <MaterialIcon name="check_circle" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold">{stats.approved}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Recent Claims</h3>
              <p className="text-sm text-slate-500">Manage and process the latest submissions.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-semibold">Claim ID</th>
                  <th className="px-6 py-4 font-semibold">Policy No</th>
                  <th className="px-6 py-4 font-semibold">Claimant</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {recent.map((c) => (
                  <tr
                    key={c._id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-[#005299]">
                      #{c._id.slice(-6)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        type="button"
                        onClick={() => setDetailClaim(c)}
                        className="text-[#005299] dark:text-sky-400 font-medium hover:underline text-left"
                      >
                        {c.policyNumber}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">
                      {c.policyholderName || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${c.status === 'Pending'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : c.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        className="inline-flex items-center justify-center size-8 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                        title="Approve"
                        onClick={() => updateStatus(c._id, 'Approved')}
                      >
                        <MaterialIcon name="check_circle" className="text-lg" />
                      </button>
                      <button
                        className="inline-flex items-center justify-center size-8 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Reject"
                        onClick={() => updateStatus(c._id, 'Rejected')}
                      >
                        <MaterialIcon name="cancel" className="text-lg" />
                      </button>
                    </td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                      No claims found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detailClaim && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="claim-detail-title"
          onClick={() => setDetailClaim(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start gap-4">
              <div>
                <h3 id="claim-detail-title" className="text-lg font-bold text-slate-900 dark:text-white">
                  Claim details
                </h3>
                <p className="text-xs text-slate-500 mt-1 font-mono">ID #{detailClaim._id.slice(-6)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailClaim(null)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                aria-label="Close"
              >
                <MaterialIcon name="close" />
              </button>
            </div>
            <div className="p-6 space-y-5 text-sm text-slate-700 dark:text-slate-200">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Policy number</p>
                  <p className="font-medium text-slate-900 dark:text-white">{detailClaim.policyNumber}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Claimant</p>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {detailClaim.policyholderName || '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#005299]/20 bg-[#005299]/5 dark:bg-[#005299]/10 p-4">
                  <p className="text-xs font-semibold text-[#005299] uppercase tracking-wide mb-1">
                    Insurance category
                  </p>
                  <p className="text-base font-bold text-slate-900 dark:text-white">
                    {detailClaim.claimType} claim
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {claimCategoryInfo(detailClaim.claimType).description}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason / description</p>
                  <p className="mt-1 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{detailClaim.reason}</p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</p>
                    <p className="mt-1 font-semibold">{detailClaim.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Submitted</p>
                    <p className="mt-1">{new Date(detailClaim.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Uploaded documents
                </p>
                {normalizeClaimDocuments(detailClaim).length === 0 ? (
                  <p className="text-slate-500 text-xs">No documents were uploaded with this claim.</p>
                ) : (
                  <ul className="space-y-2">
                    {normalizeClaimDocuments(detailClaim).map((doc, idx) => (
                      <li
                        key={`${detailClaim._id}-doc-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2"
                      >
                        <span className="truncate text-xs font-medium" title={doc.originalName}>
                          {doc.originalName}
                        </span>
                        {doc.canDownload ? (
                          <button
                            type="button"
                            onClick={() => downloadClaimDocument(detailClaim._id, idx, doc.originalName)}
                            className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[#005299] text-white text-xs font-semibold px-2.5 py-1.5 hover:bg-[#005299]/90"
                          >
                            <MaterialIcon name="download" className="!text-base" />
                            Download
                          </button>
                        ) : (
                          <span className="shrink-0 text-[11px] text-slate-400">Demo name only</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    updateStatus(detailClaim._id, 'Approved')
                    setDetailClaim(null)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-2 hover:bg-emerald-500"
                >
                  <MaterialIcon name="check_circle" className="!text-base" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateStatus(detailClaim._id, 'Rejected')
                    setDetailClaim(null)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-2 hover:bg-red-500"
                >
                  <MaterialIcon name="cancel" className="!text-base" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AdminLoginRoute() {
  return <UnifiedLoginPage initialMode="admin" onUserLogin={() => {}} />
}

function AppRouter() {
  const auth = useAuth()
  const location = useLocation()

  const isAdminRoute = location.pathname.startsWith('/admin')

  if (!isAdminRoute && !auth.token) {
    return <UnifiedLoginPage initialMode="user" onUserLogin={auth.saveAuth} />
  }

  return (
    <Routes>
      {/* User app */}
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/claims/new" element={<ClaimSubmitPage user={auth.user} />} />
      <Route path="/*" element={<UserShell user={auth.user} onLogout={auth.logout} />} />

      {/* Admin app */}
      <Route path="/admin/login" element={<AdminLoginRoute />} />
      <Route
        path="/admin/dashboard"
        element={
          <RequireAdmin>
            <AdminLayout>
              <AdminDashboardPage />
            </AdminLayout>
          </RequireAdmin>
        }
      />
      <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  )
}
export default function AppNew() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}

