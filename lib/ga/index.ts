import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(process.cwd(), 'data', 'ga-tokens.json');

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(userId: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    state: userId,
  });
}

// Token storage helpers using JSON file
function readTokens(): Record<string, any> {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(TOKEN_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch { return {}; }
}

function writeTokens(tokens: Record<string, any>) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function saveTokens(userId: string, tokens: any, propertyId?: string) {
  const all = readTokens();
  all[userId] = { ...tokens, propertyId: propertyId || all[userId]?.propertyId };
  writeTokens(all);
}

export function getTokens(userId: string): any | null {
  const all = readTokens();
  return all[userId] || null;
}

export function removeTokens(userId: string) {
  const all = readTokens();
  delete all[userId];
  writeTokens(all);
}

export async function exchangeCode(code: string): Promise<any> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function getAuthenticatedClient(userId: string) {
  const tokens = getTokens(userId);
  if (!tokens) return null;
  
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  
  // Refresh if expired
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    try {
      const { credentials } = await client.refreshAccessToken();
      saveTokens(userId, credentials);
      client.setCredentials(credentials);
    } catch {
      removeTokens(userId);
      return null;
    }
  }
  
  return client;
}

// List GA4 properties the user has access to
export async function listProperties(userId: string): Promise<Array<{id: string, name: string}>> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return [];
  
  const admin = google.analyticsadmin({ version: 'v1beta', auth: client });
  try {
    const res = await admin.accountSummaries.list();
    const properties: Array<{id: string, name: string}> = [];
    for (const account of res.data.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        if (prop.property && prop.displayName) {
          const id = prop.property.replace('properties/', '');
          properties.push({ id, name: prop.displayName });
        }
      }
    }
    return properties;
  } catch (e) {
    console.error('GA list properties error:', e);
    return [];
  }
}

// Fetch analytics data
export async function fetchAnalytics(userId: string, days: number = 30) {
  const tokens = getTokens(userId);
  if (!tokens?.propertyId) return null;
  
  const client = await getAuthenticatedClient(userId);
  if (!client) return null;
  
  const analytics = google.analyticsdata({ version: 'v1beta', auth: client });
  const propertyId = tokens.propertyId;
  
  const startDate = `${days}daysAgo`;
  const endDate = 'today';
  
  try {
    // 1. Overview metrics
    const overview = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
          { name: 'conversions' },
          { name: 'ecommercePurchases' },
        ],
      },
    });
    
    // 2. Sessions by landing page
    const landingPages = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [
          { name: 'sessions' },
          { name: 'conversions' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      },
    });
    
    // 3. Traffic by source/medium
    const traffic = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      },
    });
    
    // 4. Sessions by day
    const daily = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'conversions' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      },
    });
    
    // Parse results
    const overviewRow = overview.data.rows?.[0]?.metricValues || [];
    const parseMetric = (arr: any[], idx: number) => parseFloat(arr[idx]?.value || '0');
    
    return {
      overview: {
        sessions: parseMetric(overviewRow, 0),
        users: parseMetric(overviewRow, 1),
        newUsers: parseMetric(overviewRow, 2),
        bounceRate: Math.round(parseMetric(overviewRow, 3) * 1000) / 10,
        avgSessionDuration: Math.round(parseMetric(overviewRow, 4)),
        pageViews: parseMetric(overviewRow, 5),
        conversions: parseMetric(overviewRow, 6),
        purchases: parseMetric(overviewRow, 7),
      },
      landingPages: (landingPages.data.rows || []).map(row => ({
        page: row.dimensionValues?.[0]?.value || '',
        sessions: parseFloat(row.metricValues?.[0]?.value || '0'),
        conversions: parseFloat(row.metricValues?.[1]?.value || '0'),
        conversionRate: parseFloat(row.metricValues?.[0]?.value || '0') > 0 
          ? Math.round((parseFloat(row.metricValues?.[1]?.value || '0') / parseFloat(row.metricValues?.[0]?.value || '0')) * 1000) / 10 
          : 0,
        bounceRate: Math.round(parseFloat(row.metricValues?.[2]?.value || '0') * 1000) / 10,
        avgDuration: Math.round(parseFloat(row.metricValues?.[3]?.value || '0')),
      })),
      traffic: (traffic.data.rows || []).map(row => ({
        sourceMedium: row.dimensionValues?.[0]?.value || '',
        sessions: parseFloat(row.metricValues?.[0]?.value || '0'),
        users: parseFloat(row.metricValues?.[1]?.value || '0'),
        conversions: parseFloat(row.metricValues?.[2]?.value || '0'),
        bounceRate: Math.round(parseFloat(row.metricValues?.[3]?.value || '0') * 1000) / 10,
      })),
      daily: (daily.data.rows || []).map(row => ({
        date: row.dimensionValues?.[0]?.value || '',
        sessions: parseFloat(row.metricValues?.[0]?.value || '0'),
        conversions: parseFloat(row.metricValues?.[1]?.value || '0'),
      })),
    };
  } catch (e: any) {
    console.error('GA fetch error:', e.message);
    return null;
  }
}
