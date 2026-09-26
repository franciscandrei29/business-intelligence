import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Politica GDPR — Kimono BI' },
  { name: 'description', content: 'Informatii despre drepturile tale GDPR si cum prelucram datele tale personale.' },
];

export default function GdprPage() {
  const lastUpdated = '25 aprilie 2026';
  const companyName = 'Kimono Group SRL';
  const companyAddress = 'Romania';
  const contactEmail = 'gdpr@kimonogroup.ro';
  const appName = 'Kimono BI';
  const appUrl = 'https://bi.kimonogroup.ro';

  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link to="/" className="legal-back">Kimono BI</Link>
          <h1>Politica GDPR</h1>
          <p className="legal-meta">Ultima actualizare: {lastUpdated}</p>
        </div>

        <div className="legal-content">

          <section>
            <h2>1. Cine suntem</h2>
            <p>
              {companyName} (&quot;noi&quot;, &quot;ne&quot;, &quot;nostru&quot;) opereaza platforma {appName} accesibila la {appUrl}.
              Suntem operator de date personale in sensul Regulamentului (UE) 2016/679 (GDPR).
            </p>
            <p>
              <strong>Date de contact operator:</strong><br />
              {companyName}, {companyAddress}<br />
              Email: <a href={'mailto:' + contactEmail}>{contactEmail}</a>
            </p>
          </section>

          <section>
            <h2>2. Ce date colectam si de ce</h2>

            <h3>2.1 Date furnizate la inregistrare</h3>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Scop</th>
                  <th>Temei legal</th>
                  <th>Retentie</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Prenume, nume</td>
                  <td>Identificare cont, personalizare interfata</td>
                  <td>Executarea contractului (Art. 6(1)(b))</td>
                  <td>Durata cont + 30 zile dupa stergere</td>
                </tr>
                <tr>
                  <td>Adresa email</td>
                  <td>Autentificare, notificari, comunicare</td>
                  <td>Executarea contractului (Art. 6(1)(b))</td>
                  <td>Durata cont + 30 zile</td>
                </tr>
                <tr>
                  <td>Telefon</td>
                  <td>Suport client (optional)</td>
                  <td>Consimtamant (Art. 6(1)(a))</td>
                  <td>Durata cont</td>
                </tr>
                <tr>
                  <td>Denumire firma, website</td>
                  <td>Configurarea contului business</td>
                  <td>Executarea contractului (Art. 6(1)(b))</td>
                  <td>Durata cont + 30 zile</td>
                </tr>
                <tr>
                  <td>Nr. angajati, domeniu</td>
                  <td>Personalizarea experientei, statistici anonimizate</td>
                  <td>Interes legitim (Art. 6(1)(f))</td>
                  <td>Durata cont</td>
                </tr>
                <tr>
                  <td>Parola (hash bcrypt)</td>
                  <td>Autentificare securizata</td>
                  <td>Executarea contractului (Art. 6(1)(b))</td>
                  <td>Durata cont</td>
                </tr>
              </tbody>
            </table>

            <h3>2.2 Date generate automat</h3>
            <ul>
              <li><strong>Adresa IP</strong> - securitate si prevenire frauda (retentie 90 zile)</li>
              <li><strong>User agent / browser</strong> - compatibilitate si debug (retentie 90 zile)</li>
              <li><strong>Sesiuni si token-uri</strong> - autentificare (expirate automat la 30 zile)</li>
              <li><strong>Logs de activitate</strong> - securitate si audit (retentie 12 luni)</li>
            </ul>

            <h3>2.3 Date ale magazinelor tale (procesare in numele tau)</h3>
            <p>
              Cand conectezi un magazin Shopify sau alta platforma, prelucram date comerciale (comenzi, clienti, produse)
              <strong> in calitate de persoana imputernicita (Processor)</strong> in numele tau.
              Tu esti operatorul acestor date. Noi nu le folosim in alte scopuri decat furnizarea serviciului.
            </p>
          </section>

          <section>
            <h2>3. Drepturile tale GDPR</h2>
            <p>Conform GDPR, ai urmatoarele drepturi pe care le poti exercita contactandu-ne la <a href={'mailto:' + contactEmail}>{contactEmail}</a>:</p>

            <div className="legal-rights">
              <div className="legal-right-item">
                <strong>Dreptul de acces (Art. 15)</strong>
                <p>Poti solicita o copie a tuturor datelor personale pe care le detinem despre tine.</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul la rectificare (Art. 16)</strong>
                <p>Poti corecta date incorecte sau incomplete direct din setarile contului sau prin email.</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul la stergere (Art. 17) - &quot;dreptul de a fi uitat&quot;</strong>
                <p>Poti solicita stergerea contului si a datelor asociate. Le vom sterge in 30 de zile, cu exceptia datelor necesare obligatiilor legale (ex: facturare).</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul la portabilitate (Art. 20)</strong>
                <p>Poti solicita exportul datelor tale in format JSON sau CSV din sectiunea Setari &gt; Export Date.</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul la opozitie (Art. 21)</strong>
                <p>Te poti opune prelucrarii bazate pe interes legitim (ex: comunicari marketing).</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul la restrictionarea prelucrarii (Art. 18)</strong>
                <p>Poti solicita limitarea prelucrarii datelor tale in anumite circumstante.</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul de a retrage consimtamantul</strong>
                <p>Poti retrage oricand consimtamantul pentru newsletter sau alte prelucrari bazate pe consimtamant.</p>
              </div>
              <div className="legal-right-item">
                <strong>Dreptul de a depune plangere</strong>
                <p>Poti depune plangere la Autoritatea Nationala de Supraveghere a Prelucrarii Datelor cu Caracter Personal (ANSPDCP) la <a href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">www.dataprotection.ro</a>.</p>
              </div>
            </div>

            <p>Raspundem la solicitari in maxim <strong>30 de zile calendaristice</strong>.</p>
          </section>

          <section>
            <h2>4. Securitatea datelor</h2>
            <ul>
              <li>Toate datele sunt transmise prin HTTPS (TLS 1.3)</li>
              <li>Parolele sunt stocate exclusiv ca hash-uri bcrypt (nu stocam parole in clar)</li>
              <li>Token-urile de acces la magazine externe sunt criptate AES-256 in baza de date</li>
              <li>Baza de date PostgreSQL are acces restrictat, nu este expusa public</li>
              <li>Backup-uri zilnice cu retentie 30 de zile, stocate criptat</li>
              <li>Accesul intern la date este bazat pe principiul minimului necesar</li>
            </ul>
          </section>

          <section>
            <h2>5. Transferuri internationale</h2>
            <p>
              Datele tale sunt stocate pe servere localizate in <strong>Uniunea Europeana</strong> (Romania).
              Nu transferam date in tari terte fara garantii adecvate.
            </p>
            <p>
              Servicii externe pe care le folosim (sub-procesatori):
            </p>
            <ul>
              <li><strong>OpenAI</strong> - generare insights AI (date anonimizate, fara date personale identificabile) - SUA, Standard Contractual Clauses</li>
              <li><strong>Stripe</strong> - procesare plati (date de facturare) - SUA, Standard Contractual Clauses + certificat Privacy Shield</li>
              <li><strong>Shopify</strong> - integrare magazine (in calitate de co-operator pentru datele magazinului tau)</li>
            </ul>
          </section>

          <section>
            <h2>6. Retentia datelor</h2>
            <p>Retinem datele cat timp contul tau este activ. Dupa stergerea contului:</p>
            <ul>
              <li>Datele personale - sterse in 30 de zile</li>
              <li>Datele de facturare - retinute 5 ani (obligatie legala fiscala)</li>
              <li>Backup-uri - suprascrise in 30 de zile</li>
              <li>Logs anonimizate - retinute maxim 12 luni pentru securitate</li>
            </ul>
          </section>

          <section>
            <h2>7. Modificari ale politicii</h2>
            <p>
              Putem actualiza aceasta politica periodic. Te vom notifica prin email cu minimum 14 zile inainte de
              modificarile semnificative. Data ultimei actualizari este afisata in antetul acestui document.
            </p>
          </section>

          <section>
            <h2>8. Contact</h2>
            <p>
              Pentru orice intrebare legata de GDPR sau pentru a-ti exercita drepturile, contacteaza-ne la:<br />
              <strong>Email:</strong> <a href={'mailto:' + contactEmail}>{contactEmail}</a><br />
              <strong>Subiect recomandat:</strong> &quot;Cerere GDPR - [tipul cererii]&quot;
            </p>
          </section>

        </div>

        <div className="legal-footer">
          <Link to="/">Inapoi la Kimono BI</Link>
          {' | '}
          <Link to="/politica-confidentialitate">Politica de Confidentialitate</Link>
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
