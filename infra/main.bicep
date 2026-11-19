// VTS — Azure deployment (Container Apps + PostgreSQL Flexible Server + Log Analytics).
//   az group create -n rg-vts-dev -l centralindia
//   az deployment group create -g rg-vts-dev -f infra/main.bicep -p infra/dev.bicepparam
// The GitHub Actions workflow runs this on every push to main.
targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param prefix string = 'vts'
param location string = resourceGroup().location
param dbLocation string = location
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Reuse an existing Container Apps environment (resource ID). Blank creates a new one.')
param existingEnvironmentId string = ''
@description('Use an existing PostgreSQL flexible server (FQDN). Blank creates a dedicated server. The vts database and roles must exist.')
param existingPostgresHost string = ''
param dbAdminUser string = 'vtsadmin'
@secure()
param dbAdminPassword string
@secure()
param appDbPassword string
@secure()
param jwtSecret string
@description('true loads the demo VTS centre (zones, users) on start.')
param seedDemoData bool = false
@secure()
param demoPassword string = ''

@description('AIS input: SIMULATOR | NMEA_TCP | NMEA_UDP | PROVIDER | NONE')
@allowed(['SIMULATOR', 'NMEA_TCP', 'NMEA_UDP', 'PROVIDER', 'NONE'])
param aisSource string = 'SIMULATOR'
param nmeaHost string = ''
param nmeaPort int = 10110
param aisProviderUrl string = ''
@secure()
param aisProviderKey string = ''

@description('Port Community System base URL (blank = standalone VTS).')
param pcsUrl string = ''
@secure()
param pcsApiKey string = ''
@secure()
param pcsWebhookSecret string = ''

param dbSku string = 'Standard_B1ms'
param dbTier string = 'Burstable'

var uniq = uniqueString(resourceGroup().id)
var createEnv = empty(existingEnvironmentId)
var createPg = empty(existingPostgresHost)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (createEnv) {
  name: 'log-${prefix}-${uniq}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 90 }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (createPg) {
  name: 'psql-${prefix}-${uniq}-${dbLocation}'
  location: dbLocation
  sku: { name: dbSku, tier: dbTier }
  properties: {
    version: '16'
    administratorLogin: dbAdminUser
    administratorLoginPassword: dbAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}
resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (createPg) {
  parent: pg
  name: 'vts'
}
resource pgAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (createPg) {
  parent: pg
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = if (createEnv) {
  name: 'cae-${prefix}-${uniq}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs!.properties.customerId
        sharedKey: logs!.listKeys().primarySharedKey
      }
    }
  }
}

var host = createPg ? pg!.properties.fullyQualifiedDomainName : existingPostgresHost
var adminUrl = 'postgresql://${dbAdminUser}:${uriComponent(dbAdminPassword)}@${host}:5432/vts?sslmode=require'
var appUrl = 'postgresql://vts_app:${uriComponent(appDbPassword)}@${host}:5432/vts?sslmode=require'
var optionalSecrets = concat(
  demoPassword != '' ? [{ name: 'demo-password', value: demoPassword }] : [],
  pcsApiKey != '' ? [{ name: 'pcs-api-key', value: pcsApiKey }] : [],
  pcsWebhookSecret != '' ? [{ name: 'pcs-webhook-secret', value: pcsWebhookSecret }] : [],
  aisProviderKey != '' ? [{ name: 'ais-provider-key', value: aisProviderKey }] : [])
var optionalEnv = concat(
  demoPassword != '' ? [{ name: 'DEMO_PASSWORD', secretRef: 'demo-password' }] : [],
  pcsApiKey != '' ? [{ name: 'PCS_API_KEY', secretRef: 'pcs-api-key' }] : [],
  pcsWebhookSecret != '' ? [{ name: 'PCS_WEBHOOK_SECRET', secretRef: 'pcs-webhook-secret' }] : [],
  aisProviderKey != '' ? [{ name: 'AIS_PROVIDER_KEY', secretRef: 'ais-provider-key' }] : [])

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${prefix}-${uniq}'
  location: location
  properties: {
    managedEnvironmentId: createEnv ? env.id : existingEnvironmentId
    configuration: {
      ingress: { external: true, targetPort: 4100, transport: 'auto' }
      secrets: concat([
        { name: 'admin-database-url', value: adminUrl }
        { name: 'database-url', value: appUrl }
        { name: 'app-db-password', value: appDbPassword }
        { name: 'db-admin-password', value: dbAdminPassword }
        { name: 'jwt-secret', value: jwtSecret }
      ], optionalSecrets)
    }
    template: {
      containers: [
        {
          name: 'vts'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'ADMIN_DATABASE_URL', secretRef: 'admin-database-url' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'APP_DB_PASSWORD', secretRef: 'app-db-password' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'APP_VERSION', value: last(split(image, ':')) }
            { name: 'SEED_DEMO_DATA', value: seedDemoData ? 'true' : 'false' }
            { name: 'AIS_SOURCE', value: aisSource }
            { name: 'NMEA_HOST', value: nmeaHost }
            { name: 'NMEA_PORT', value: string(nmeaPort) }
            { name: 'AIS_PROVIDER_URL', value: aisProviderUrl }
            { name: 'PCS_URL', value: pcsUrl }
          ], optionalEnv)
          probes: [
            { type: 'Readiness', httpGet: { path: '/ready', port: 4100 }, initialDelaySeconds: 10, periodSeconds: 30, failureThreshold: 48 }
            { type: 'Liveness', httpGet: { path: '/health', port: 4100 }, initialDelaySeconds: 60, periodSeconds: 30 }
          ]
        }
      ]
      // The traffic engine is a single writer (one VTS image per centre); scale up, not out.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [ pgDb, pgAzure ]
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output appName string = app.name
output postgresServer string = host
