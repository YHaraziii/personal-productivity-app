/** A simulated device: its own local database, repo and sync engine. */
import type { PGlite } from '@electric-sql/pglite'
import { AppDB } from '../../src/data/db'
import { Repo } from '../../src/data/repo'
import { newId } from '../../src/lib/ids'
import { SyncEngine } from '../../src/sync/engine'
import { pgRemote, type TestRemote } from './pg'

export interface Device {
  dbName: string
  db: AppDB
  repo: Repo
  engine: SyncEngine
  remote: TestRemote
  online: boolean
  /** Close and reopen the local database, as a page reload would. */
  reload(): Promise<void>
  sync(): Promise<void>
}

export async function createDevice(pg: PGlite, userId: string, dbName = `test-${newId()}`): Promise<Device> {
  const remote = pgRemote(pg, userId)
  const device = { dbName, remote, online: true } as Device
  const open = async () => {
    device.db = new AppDB(dbName)
    device.repo = new Repo(device.db, userId)
    device.engine = new SyncEngine(device.db, remote, { isOnline: () => device.online })
    await device.engine.init()
  }
  device.reload = async () => {
    device.engine.stop()
    device.db.close()
    await open()
  }
  device.sync = () => device.engine.syncNow()
  await open()
  return device
}

export const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at)
