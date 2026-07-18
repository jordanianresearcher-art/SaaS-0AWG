import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../data/AppDataContext'
import { LoadingBlock } from '../components/ui'
import { env } from '../lib/env'

/** Entering /demo seeds (or resumes) the local demo shop and opens the app. */
export default function DemoEntryPage() {
  const { enterDemo } = useAppData()
  const navigate = useNavigate()

  useEffect(() => {
    if (!env.demoModeEnabled) {
      navigate('/', { replace: true })
      return
    }
    enterDemo()
    navigate('/app', { replace: true })
  }, [enterDemo, navigate])

  return <LoadingBlock label="Setting up the demo shop…" />
}
