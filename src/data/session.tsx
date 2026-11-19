/**
 * Everything that exists per signed-in user: the local database, the write
 * API (repo) and the sync engine. Created when a user signs in, torn down on
 * sign-out or unmount.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Dexie from 'dexie'
import type { Remote } from '../sync/engine'
import { SyncEngine } from '../sync/engine'
import { AppDB, dbNameFor, openUserDb } from './db'
import { Repo } from './repo'

export interface AppSession {
  userId: string
  db: AppDB
  repo: Repo
  engine: SyncEngine
  remote: Remote
}

const SessionContext = createContext<AppSession | null>(null)

export function createSession(userId: string, remote: Remote): AppSession {
  const db = openUserDb(userId)
  const engine = new SyncEngine(db, remote)
  const repo = new Repo(db, userId, () => engine.requestSync())
  return { userId, db, repo, engine, remote }
}

/** Permanently remove a user's local database (used on sign-out). */
export async function deleteLocalData(userId: string): Promise<void> {
  await Dexie.delete(dbNameFor(userId))
}

export function SessionProvider({
  userId,
  remote,
  children,
  fallback,
}: {
  userId: string
  remote: Remote
  children: ReactNode
  fallback: ReactNode
}) {
  const [session, setSession] = useState<AppSession | null>(null)

  useEffect(() => {
    const next = createSession(userId, remote)
    let active = true
    void next.engine.start().then(() => {
      if (active) setSession(next)
    })
    // Default labels are created once, after the first successful download,
    // so a second device never duplicates them.
    const seed = () => {
      if (next.engine.getState().initialPullDone) {
        void next.repo.seedDefaultLabels().catch(() => console.warn('[session] could not create default labels'))
        offSeed()
      }
    }
    const offSeed = next.engine.subscribe(seed)
    seed()
    return () => {
      active = false
      offSeed()
      next.engine.stop()
      next.db.close()
      setSession(null)
    }
  }, [userId, remote])

  if (!session) return <>{fallback}</>
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useSession(): AppSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside SessionProvider')
  return session
}
