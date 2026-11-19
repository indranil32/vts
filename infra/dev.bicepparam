using './main.bicep'

// Trial / personal subscription. Demo centre with simulated AIS traffic.
param prefix = 'vtsdev'
param image = readEnvironmentVariable('VTS_IMAGE', 'ghcr.io/indranil32/vts:latest')
param location = 'centralindia'
param dbLocation = 'uksouth'
param existingEnvironmentId = readEnvironmentVariable('VTS_EXISTING_ENV_ID', '')
param existingPostgresHost = readEnvironmentVariable('VTS_EXISTING_PG_HOST', '')
param dbAdminUser = readEnvironmentVariable('VTS_DB_ADMIN_USER', 'vtsadmin')
param seedDemoData = true
param aisSource = 'SIMULATOR'
param pcsUrl = readEnvironmentVariable('VTS_PCS_URL', '')
// Secrets come from the workflow (or your shell), never from this file.
param dbAdminPassword = readEnvironmentVariable('VTS_DB_ADMIN_PASSWORD', '')
param appDbPassword = readEnvironmentVariable('VTS_APP_DB_PASSWORD', '')
param jwtSecret = readEnvironmentVariable('VTS_JWT_SECRET', '')
param demoPassword = readEnvironmentVariable('VTS_DEMO_PASSWORD', '')
param pcsApiKey = readEnvironmentVariable('VTS_PCS_API_KEY', '')
param pcsWebhookSecret = readEnvironmentVariable('VTS_PCS_WEBHOOK_SECRET', '')
