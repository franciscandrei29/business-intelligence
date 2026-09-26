import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Politica Cookies — Kimono BI' },
  { name: 'description', content: 'Cum folosim cookie-urile si cum le poti controla.' },
];

export default function CookiesPage() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link to="/" className="legal-back">Kimono BI</Link>
          <h1>Politica Cookies</h1>
          <p className="legal-meta">Ultima actualizare: 25 aprilie 2026</p>
        </div>

        <div className="legal-content">

          <section>
            <h2>1. Ce sunt cookie-urile</h2>
            <p>
              Cookie-urile sunt fisiere text de mici dimensiuni stocate in browserul tau atunci cand vizitezi un site web.
              Sunt folosite pentru a retine preferintele tale, a asigura functionarea aplicatiei si a imbunatati experienta.
            </p>
          </section>

          <section>
            <h2>2. Ce tipuri de cookie-uri folosim</h2>

            <h3>2.1 Cookie-uri strict necesare (nu necesita consimtamant)</h3>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Nume</th>
                  <th>Scop</th>
                  <th>Durata</th>
                  <th>Tip</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>__session</code></td>
                  <td>Sesiune de autentificare - mentine utilizatorul logat</td>
                  <td>30 zile</td>
                  <td>Esential</td>
                </tr>
                <tr>
                  <td><code>csrf_token</code></td>
                  <td>Protectie impotriva atacurilor CSRF</td>
                  <td>Sesiune browser</td>
                  <td>Esential</td>
                </tr>
                <tr>
                  <td><code>workspace_id</code></td>
                  <td>Retine workspace-ul activ selectat</td>
                  <td>30 zile</td>
                  <td>Functional</td>
                </tr>
              </tbody>
            </table>

            <h3>2.2 Cookie-uri functionale (necesita consimtamant)</h3>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Nume</th>
                  <th>Scop</th>
                  <th>Durata</th>
                  <th>Tip</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>lang_pref</code></td>
                  <td>Retine preferinta de limba (RO/EN)</td>
                  <td>1 an</td>
                  <td>Functional</td>
                </tr>
                <tr>
                  <td><code>sidebar_state</code></td>
                  <td>Retine starea sidebar (deschis/inchis)</td>
                  <td>30 zile</td>
                  <td>Functional</td>
                </tr>
                <tr>
                  <td><code>theme_pref</code></td>
                  <td>Preferinta tema (light/dark - viitor)</td>
                  <td>1 an</td>
                  <td>Functional</td>
                </tr>
              </tbody>
            </table>

            <h3>2.3 Cookie-uri analitice (necesita consimtamant)</h3>
            <p>
              Folosim <strong>Plausible Analytics</strong> - o solutie privacy-friendly care nu foloseste cookie-uri
              tracking si este conforma GDPR fara consimtamant explicit pentru vizitatorii din UE.
              Nu folosim Google Analytics sau alte instrumente cu cookie-uri third-party de tracking.
            </p>

            <h3>2.4 Cookie-uri de marketing (nu folosim)</h3>
            <p>
              Nu folosim cookie-uri de marketing, retargeting sau tracking cross-site.
              Nu partajam date cu retele publicitare.
            </p>
          </section>

          <section>
            <h2>3. Cum controlezi cookie-urile</h2>

            <h3>3.1 Prin setarile aplicatiei</h3>
            <p>
              Poti gestiona preferintele de cookie-uri din <strong>Setari &gt; Confidentialitate</strong> in contul tau.
              Cookie-urile esentiale nu pot fi dezactivate deoarece aplicatia nu functioneaza fara ele.
            </p>

            <h3>3.2 Prin setarile browserului</h3>
            <p>Poti sterge sau bloca cookie-urile din setarile browserului:</p>
            <ul>
              <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer">Google Chrome</a></li>
              <li><a href="https://support.mozilla.org/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer">Mozilla Firefox</a></li>
              <li><a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471" target="_blank" rel="noopener noreferrer">Apple Safari</a></li>
              <li><a href="https://support.microsoft.com/microsoft-edge/delete-cookies-in-microsoft-edge-63947406" target="_blank" rel="noopener noreferrer">Microsoft Edge</a></li>
            </ul>
            <p>
              <strong>Atentie:</strong> Blocarea cookie-urilor esentiale va impiedica functionarea autentificarii.
            </p>
          </section>

          <section>
            <h2>4. Cookie-uri third-party</h2>
            <p>
              Platforma integreaza urmatoarele servicii externe care pot seta cookie-uri proprii:
            </p>
            <ul>
              <li><strong>Stripe</strong> - procesare plati (cookie-uri pentru fraud prevention)</li>
              <li><strong>Google</strong> - autentificare Google OAuth (cookie-uri de sesiune Google)</li>
            </ul>
            <p>
              Aceste cookie-uri sunt guvernate de politicile proprii ale furnizorilor respectivi.
            </p>
          </section>

          <section>
            <h2>5. Contact</h2>
            <p>
              Pentru intrebari despre cookie-uri, contacteaza-ne la{' '}
              <a href="mailto:gdpr@kimonogroup.ro">gdpr@kimonogroup.ro</a>.
            </p>
          </section>

        </div>

        <div className="legal-footer">
          <Link to="/">Inapoi la Kimono BI</Link>
          {' | '}
          <Link to="/gdpr">Politica GDPR</Link>
          {' | '}
          <Link to="/termeni">Termeni si Conditii</Link>
          {' | '}
          <Link to="/rambursare">Politica de Rambursare</Link>
        </div>
      </div>
    </div>
  );
}
