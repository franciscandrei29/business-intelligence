import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Termeni si Conditii — Kimono BI' },
  { name: 'description', content: 'Termenii si conditiile de utilizare ale platformei Kimono BI.' },
];

export default function TermeniPage() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link to="/" className="legal-back">Kimono BI</Link>
          <h1>Termeni si Conditii</h1>
          <p className="legal-meta">Ultima actualizare: 25 aprilie 2026</p>
        </div>

        <div className="legal-content">

          <section>
            <h2>1. Acceptarea termenilor</h2>
            <p>
              Prin crearea unui cont sau utilizarea platformei Kimono BI (&quot;Platforma&quot;, &quot;Serviciul&quot;),
              accesibila la bi.kimonogroup.ro, esti de acord cu acesti Termeni si Conditii. Daca nu esti de acord,
              nu folosi Platforma.
            </p>
            <p>
              Platforma este operata de <strong>Kimono Group SRL</strong>, Romania
              (&quot;Kimono BI&quot;, &quot;noi&quot;, &quot;ne&quot;).
            </p>
          </section>

          <section>
            <h2>2. Descrierea serviciului</h2>
            <p>
              Kimono BI este o platforma SaaS de Business Intelligence pentru magazine eCommerce care ofera:
            </p>
            <ul>
              <li>Analiza datelor de vanzari, clienti si produse</li>
              <li>Insights generate cu inteligenta artificiala</li>
              <li>Integrari cu platforme eCommerce (Shopify) si marketing</li>
              <li>Rapoarte automate si alerte</li>
              <li>Instrumente de prognoza si segmentare clienti</li>
            </ul>
          </section>

          <section>
            <h2>3. Conturi si acces</h2>

            <h3>3.1 Eligibilitate</h3>
            <p>
              Serviciul este destinat persoanelor juridice (firme) si persoanelor fizice autorizate. Trebuie sa ai
              minim 18 ani si capacitate legala de a incheia contracte.
            </p>

            <h3>3.2 Contul tau</h3>
            <p>
              Esti responsabil pentru securitatea credentialelor contului tau. Notifica-ne imediat la
              <a href="mailto:support@kimonogroup.ro"> support@kimonogroup.ro</a> in caz de acces neautorizat.
              Nu esti autorizat sa imparti credentialele cu alte persoane - foloseste functionalitatea de team members.
            </p>

            <h3>3.3 Trial gratuit</h3>
            <p>
              Oferim un trial gratuit de 14 zile fara card de credit. La sfarsitul trialului, contul trece automat
              la planul Free cu limitari. Nu se percep taxe automate fara acordul tau explicit.
            </p>
          </section>

          <section>
            <h2>4. Planuri si facturare</h2>

            <h3>4.1 Planuri disponibile</h3>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Pret</th>
                  <th>Comenzi/luna</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Free</td><td>0</td><td>Pana la 100</td></tr>
                <tr><td>Starter</td><td>$49/luna</td><td>Pana la 1.000</td></tr>
                <tr><td>Pro</td><td>$99/luna</td><td>Pana la 5.000</td></tr>
                <tr><td>Enterprise</td><td>De la $199/luna</td><td>5.000+</td></tr>
              </tbody>
            </table>

            <h3>4.2 Facturare</h3>
            <p>
              Abonamentele se facureaza lunar sau anual (cu discount), in avans. Platile se proceseaza securizat
              prin Stripe. Preturile sunt exprimate in USD, fara TVA.
            </p>

            <h3>4.3 Modificarea planului</h3>
            <p>
              Poti face upgrade oricand - diferenta se calculeaza pro-rata.
              Downgrade-ul intra in vigoare la urmatorul ciclu de facturare.
            </p>
          </section>

          <section>
            <h2>5. Utilizarea acceptabila</h2>
            <p>Nu ai dreptul sa utilizezi Platforma pentru:</p>
            <ul>
              <li>Activitati ilegale sau care incalca drepturile tertilor</li>
              <li>Spam sau comunicari nesolicitate</li>
              <li>Reverse engineering, decompilare sau acces neautorizat la codul sursa</li>
              <li>Vanzarea, inchirierea sau sublicentierea accesului la Platforma</li>
              <li>Incarcarea de malware, virusuri sau continut daunatior</li>
              <li>Supraincarcarea intentionata a infrastructurii (DDoS)</li>
              <li>Scraping automat fara autorizare scrisa</li>
            </ul>
          </section>

          <section>
            <h2>6. Proprietate intelectuala</h2>
            <p>
              Platforma, codul sursa, design-ul, algoritmii si continutul generat de noi sunt proprietatea exclusiva
              a Kimono Group SRL, protejate de legile dreptului de autor.
            </p>
            <p>
              <strong>Datele tale</strong> (date din magazine, rapoarte, insights generate din datele tale) iti apartin.
              Iti acordam o licenta de utilizare a Platformei, nu transferam proprietatea algoritmilor.
            </p>
          </section>

          <section>
            <h2>7. Confidentialitate si securitate date</h2>
            <p>
              Prelucrarea datelor personale este guvernata de{' '}
              <Link to="/gdpr">Politica GDPR</Link> si{' '}
              <Link to="/politica-confidentialitate">Politica de Confidentialitate</Link>,
              care fac parte integranta din acesti Termeni.
            </p>
            <p>
              Pentru datele magazinelor conectate, actionam ca persoana imputernicita (Processor) in numele tau.
              Inchei cu noi implicit un acord de procesare date (DPA) conform Art. 28 GDPR.
            </p>
          </section>

          <section>
            <h2>8. Disponibilitate si SLA</h2>
            <p>
              Ne straduim sa asiguram disponibilitate de <strong>99,5%</strong> lunar, excluzand:
            </p>
            <ul>
              <li>Mentenanta planificata (anuntata cu 48h inainte prin email)</li>
              <li>Evenimente de forta majora</li>
              <li>Probleme cauzate de servicii terte (Shopify, Google, etc.)</li>
            </ul>
            <p>
              Statusul platformei este disponibil la <a href="https://status.kimonogroup.ro" target="_blank" rel="noopener noreferrer">status.kimonogroup.ro</a>.
            </p>
          </section>

          <section>
            <h2>9. Limitarea raspunderii</h2>
            <p>
              In masura maxima permisa de lege, Kimono Group SRL nu este raspunzatoare pentru:
            </p>
            <ul>
              <li>Pierderi indirecte, incidentale sau de profit</li>
              <li>Decizii de business luate pe baza datelor din Platforma</li>
              <li>Intreruperi cauzate de forte externe sau servicii terte</li>
              <li>Pierderea datelor cauzata de actiunile utilizatorului</li>
            </ul>
            <p>
              Raspunderea noastra maxima este limitata la suma platita de tine in ultimele 12 luni.
            </p>
          </section>

          <section>
            <h2>10. Rezilierea</h2>

            <h3>10.1 Reziliere de catre tine</h3>
            <p>
              Poti sterge contul oricand din Setari &gt; Abonament &gt; Sterge cont.
              Datele sunt sterse in 30 de zile conform{' '}
              <Link to="/gdpr">Politicii GDPR</Link>.
            </p>

            <h3>10.2 Reziliere de catre noi</h3>
            <p>
              Putem suspenda sau inchide contul tau in caz de: incalcare a termenilor, neplata,
              activitate frauduloasa, sau la cererea autoritatilor legale. Vei fi notificat in avans cu 14 zile
              pentru incalcari corectabile.
            </p>
          </section>

          <section>
            <h2>11. Modificari ale serviciului si termenilor</h2>
            <p>
              Ne rezervam dreptul de a modifica Serviciul sau acesti Termeni cu notificare de minimum 30 de zile.
              Continuarea utilizarii dupa data intrarii in vigoare constituie acceptul modificarilor.
            </p>
          </section>

          <section>
            <h2>12. Legea aplicabila</h2>
            <p>
              Acesti Termeni sunt guvernati de legea romana. Orice disputa va fi solutionata de instantele
              competente din Romania.
            </p>
          </section>

          <section>
            <h2>13. Contact</h2>
            <p>
              Pentru orice intrebari legate de acesti Termeni:<br />
              <strong>Email:</strong> <a href="mailto:legal@kimonogroup.ro">legal@kimonogroup.ro</a><br />
              <strong>Subiect:</strong> &quot;Termeni si Conditii - [intrebarea ta]&quot;
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
          <Link to="/rambursare">Politica de Rambursare</Link>
        </div>
      </div>
    </div>
  );
}
