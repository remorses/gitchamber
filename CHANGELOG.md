# Changelog

## 2024-12-14

### Changed

- SQLite cache data now expires after 7 days (previously 24 hours of inactivity)
- Simplified alarm logic: data is deleted unconditionally when alarm fires (no activity check)

### Fixed

- Orphaned databases that never had alarms set are now cleaned up on next access
- Added `ensureAlarmExists()` that runs on every request to detect and fix missing alarms
- Uses oldest `createdAt` or `firstFetched` timestamp to calculate proper expiration
