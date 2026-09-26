import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Politica de Confidentialitate — Kimono BI' },
  { name: 'description', content: 'Cum colectam, folosim si protejam datele tale personale.' },
];

export default function ConfidentialitiatePage() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link to="/" className="legal-back">Kimono BI</Link>
          <h1>Politica de Confidentialitate</h1>
          <p className="legal-meta">Ultima actualizare: 25 aprilie 2026</p>
        </div>

        <div className="legal-content">

          <section>
            <h2>1. Introducere</h2>
            <p>
              Kimono Group SRL (&quot;Kimono BI&quot;, &quot;noi&quot;) respecta confidentialitatea datelor tale.
              Aceasta Politica explica ce informatii colectam, cum le folosim si drepturile tale.
            </p>
            <p>
              Aceasta politica se aplica platformei Kimono BI (bi.kimonogroup.ro) si este complementara{' '}
              <Link to="/gdpr">Politicii GDPR</Link> care detaliaza drepturile tale legale.
            </p>
          </section>

          <section>
            <h2>2. Date colectate</h2>

            <h3>Date furnizate de tine la inregistrare:</h3>
            <ul>
              <li>Prenume si nume</li>
              <li>Adresa de email</li>
              <li>Numar de telefon (optional)</li>
              <li>Denumire firma si website</li>
              <li>Numar angajati si domeniu de activitate (optional)</li>
              <li>Parola (stocata exclusiv ca hash criptografic, niciodata in clar)</li>
            </ul>

            <h3>Date generate automat in utilizare:</h3>
            <ul>
              <li>Adresa IP si informatii browser pentru securitate</li>
              <li>Date de sesiune si autentificare</li>
              <li>Actiuni efectuate in platforma (pentru debugging si imbunatatire)</li>
            </ul>

            <h3>Date din magazinele conectate:</h3>
            <p>
              Cand conectezi un magazin, prelucram date comerciale (comenzi, produse, clienti)
              exclusiv pentru a furniza analiza si rapoartele. Nu utilizam aceste date in alte scopuri.
            </p>
          </section>

          <section>
            <h2>3. Cum folosim datele</h2>
            <ul>
              <li><strong>Furnizarea serviciului</strong> - autentificare, dashboard, rapoarte, insights</li>
              <li><strong>Comunicare</strong> - notificari, alerte, email digest (cu consimtamantul tau)</li>
              <li><strong>Imbunatatirea produsului</strong> - analiza anonimizata a utilizarii</li>
              <li><strong>Suport client</strong> - rezolvarea problemelor raportate</li>
              <li><strong>Securitate</strong> - detectarea accesului neautorizat</li>
              <li><strong>Facturare</strong> - procesarea platilor prin Stripe</li>
            </ul>
            <p>Nu vindem, nu inchiriem si nu partajam datele tale cu terti in scopuri comerciale.</p>
          </section>

          <section>
            <h2>4. Partajarea datelor</h2>
            <p>Partajam date minimale cu urmatorii furnizori de servicii necesari pentru functionare:</p>
            <ul>
              <li><strong>Stripe</strong> - procesare plati (date de facturare)</li>
              <li><strong>OpenAI</strong> - generare insights AI (date anonimizate, fara identificatori personali)</li>
              <li><strong>Serviciu SMTP</strong> - trimitere emailuri tranzactionale</li>
            </ul>
            <p>Toti furnizorii nostri au obligatii contractuale de confidentialitate.</p>
          </section>

          <section>
            <h2>5. Securitate</h2>
            <p>Protejam datele tale prin:</p>
            <ul>
              <li>Conexiuni HTTPS criptate (TLS)</li>
              <li>Parole stocate exclusiv ca hash-uri bcrypt</li>
              <li>Tokens de acces criptate AES-256</li>
              <li>Baza de date inaccesibila din exterior</li>
              <li>Backup-uri zilnice criptate</li>
            </ul>
          </section>

          <section>
            <h2>6. Drepturile tale</h2>
            <p>
              Ai dreptul la acces, rectificare, stergere, portabilitate si opozitie.
              Detalii complete in <Link to="/gdpr">Politica GDPR</Link>.
            </p>
            <p>Contact: <a href="mailto:gdpr@kimonogroup.ro">gdpr@kimonogroup.ro</a></p>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              <strong>Kimono Group SRL</strong><br />
              Email: <a href="mailto:gdpr@kimonogroup.ro">gdpr@kimonogroup.ro</a>
            </p>
          </section>

        </div>

        <div className="legal-footer">
          <Link to="/">Inapoi la Kimono BI</Link>
          {' | '}
          <Link to="/gdpr">Politica GDPR</Link>
          {' | '}
          <Link to="/cookies">Politica Cookies</Link>
          {' | '}
          <Link to="/termeni">Termeni si Conditii</Link>
          {' | '}
          <Link to="/rambursare">Politica de Rambursare</Link>
        </div>
      </div>
    </div>
  );
}
