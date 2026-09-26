import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Politica de Rambursare — Kimono BI' },
  { name: 'description', content: 'Conditiile de rambursare si anulare abonament Kimono BI.' },
];

export default function RambursarePage() {
  return (
    <>
      <PublicNav />
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <h1>Politica de Rambursare</h1>
          <p className="legal-meta">Ultima actualizare: 25 aprilie 2026</p>
        </div>

        <div className="legal-content">

          <section>
            <h2>1. Principii generale</h2>
            <p>
              Kimono BI este un serviciu software SaaS (Software as a Service). Intelegem ca uneori asteptarile nu
              coincid cu experienta reala, de aceea avem o politica de rambursare clara si corecta.
            </p>
          </section>

          <section>
            <h2>2. Trial gratuit 14 zile</h2>
            <p>
              Oferim un trial gratuit de <strong>14 zile</strong> fara card de credit pentru toate planurile platite.
              Iti recomandam sa folosesti aceasta perioada pentru a evalua daca Platforma corespunde nevoilor tale
              inainte de a subscrie.
            </p>
          </section>

          <section>
            <h2>3. Garantie de rambursare 30 zile</h2>
            <p>
              Daca nu esti multumit cu serviciul, oferim o <strong>garantie de rambursare completa in primele 30 de zile</strong>
              de la prima plata a unui abonament (nu se aplica la reinnoiri sau upgrade-uri).
            </p>

            <h3>Conditii pentru rambursare in 30 zile:</h3>
            <ul>
              <li>Cererea sa fie transmisa in primele 30 de zile calendaristice de la data platii</li>
              <li>Sa fie prima plata (nu o reinnoire sau upgrade)</li>
              <li>Contul sa nu fi incalcat Termenii si Conditiile</li>
            </ul>

            <h3>Cum solicitati rambursarea:</h3>
            <ol>
              <li>Trimite email la <a href="mailto:billing@kimonogroup.ro">billing@kimonogroup.ro</a></li>
              <li>Subiect: &quot;Cerere rambursare - [adresa ta email]&quot;</li>
              <li>Include ID-ul comenzii (gasit in Setari &gt; Abonament &gt; Istoric facturi)</li>
              <li>Optiona: motivul rambursarii (ne ajuta sa imbunatatim serviciul)</li>
            </ol>
            <p>Procesam cererea in <strong>3-5 zile lucratoare</strong>. Suma se returneaza pe cardul original in 5-10 zile bancare.</p>
          </section>

          <section>
            <h2>4. Rambursari dupa 30 de zile</h2>
            <p>Dupa primele 30 de zile, nu oferim rambursari automate, cu urmatoarele exceptii:</p>
            <ul>
              <li><strong>Defectiune tehnica majora</strong> confirmata de echipa noastra (platforma indisponibila &gt;24h consecutiv)</li>
              <li><strong>Facturare duplicata</strong> sau eroare tehnica de procesare</li>
              <li><strong>Cazuri exceptionale</strong> analizate individual (deces, boala grava, forta majora documentata)</li>
            </ul>
          </section>

          <section>
            <h2>5. Anularea abonamentului</h2>
            <p>
              Poti anula abonamentul oricand din <strong>Setari &gt; Abonament &gt; Anuleaza abonament</strong> sau
              contactand echipa noastra.
            </p>
            <p>
              Dupa anulare:
            </p>
            <ul>
              <li>Abonamentul ramane activ pana la sfarsitul perioadei platite</li>
              <li>Nu se percepe nicio taxa de anulare</li>
              <li>Nu se acorda credite pentru zilele ramase din perioada curenta (exceptie: primele 30 zile)</li>
              <li>Dupa expirare, contul trece automat la planul Free</li>
              <li>Datele sunt pastrate 90 de zile, dupa care sterse conform Politicii GDPR</li>
            </ul>
          </section>

          <section>
            <h2>6. Upgrade si downgrade plan</h2>
            <p>
              <strong>Upgrade:</strong> Diferenta de pret se calculeaza pro-rata pentru zilele ramase. Accesul la
              functiile premium este imediat.
            </p>
            <p>
              <strong>Downgrade:</strong> Intra in vigoare la urmatorul ciclu de facturare. Nu se acorda rambursare
              pentru diferenta de plan in perioada curenta.
            </p>
          </section>

          <section>
            <h2>7. Plati anuale</h2>
            <p>
              Pentru abonamentele anuale (cu discount), garantia de 30 de zile se aplica identic.
              Dupa 30 de zile, in caz de anulare, rambursam proportional lunile neinceputeute, minus un comision
              administrativ de 10%.
            </p>
          </section>

          <section>
            <h2>8. Exceptii - ce nu rambursam</h2>
            <ul>
              <li>Taxele de tranzactie ale bancii sau Stripe (daca apar)</li>
              <li>Perioadele de trial (gratuite, deci fara rambursare)</li>
              <li>Abonamentele suspendate din cauza incalcarii Termenilor si Conditiilor</li>
              <li>Servicii personalizate sau integrari custom deja livrate</li>
            </ul>
          </section>

          <section>
            <h2>9. Dreptul de retragere (consumatori UE)</h2>
            <p>
              Conform Directivei UE 2011/83/UE privind drepturile consumatorilor, utilizatorii persoane fizice
              (nu juridice) au dreptul de retragere din contract in 14 zile de la achizitie, fara a justifica decizia.
            </p>
            <p>
              <strong>Nota:</strong> Kimono BI este destinat profesionistilor si firmelor. Daca totusi esti
              persoana fizica, contacteaza-ne la <a href="mailto:billing@kimonogroup.ro">billing@kimonogroup.ro</a>.
            </p>
          </section>

          <section>
            <h2>10. Contact pentru facturare si rambursari</h2>
            <p>
              <strong>Email:</strong> <a href="mailto:billing@kimonogroup.ro">billing@kimonogroup.ro</a><br />
              <strong>Program raspuns:</strong> Luni-Vineri, 9:00-18:00 (Romania)<br />
              <strong>Timp de raspuns:</strong> maxim 2 zile lucratoare
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
        </div>
      </div>
    </div>
    <PublicFooter />
    </>
  );
}
