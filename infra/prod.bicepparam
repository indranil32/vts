using './main.bicep'

// Production centre: dedicated database, real AIS feed, real PCS. Fill in and deploy from your own pipeline.
param prefix = 'vts'
param image = readEnvironmentVariable('VTS_IMAGE', '')
param location = readEnvironmentVariable('VTS_LOCATION', 'westeurope')
param seedDemoData = false
param aisSource = 'NMEA_TCP'
param nmeaHost = readEnvironmentVariable('VTS_NMEA_HOST', '')
param pcsUrl = readEnvironmentVariable('VTS_PCS_URL', '')
param dbSku = 'Standard_D2ds_v5'
param dbTier = 'GeneralPurpose'
param dbAdminPassword = readEnvironmentVariable('VTS_DB_ADMIN_PASSWORD', '')
param appDbPassword = readEnvironmentVariable('VTS_APP_DB_PASSWORD', '')
param jwtSecret = readEnvironmentVariable('VTS_JWT_SECRET', '')
param pcsApiKey = readEnvironmentVariable('VTS_PCS_API_KEY', '')
param pcsWebhookSecret = readEnvironmentVariable('VTS_PCS_WEBHOOK_SECRET', '')
