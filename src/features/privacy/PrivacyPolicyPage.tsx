import BrandLogo from '../../components/BrandLogo';

const POLICY_VERSION = '21 de septiembre de 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-document">
        <header className="privacy-header">
          <a className="wordmark" href="/" aria-label="Volver al inicio">
            <BrandLogo />
          </a>
          <p className="overline">INFORMACIÓN PARA CLIENTAS</p>
          <h1>Política de tratamiento de datos personales</h1>
          <p className="muted">Vigente desde el {POLICY_VERSION}</p>
        </header>

        <section>
          <h2>1. Responsable y canales de atención</h2>
          <p>
            La responsable del tratamiento es <strong>Luisa Fernanda Zapata</strong>. Las consultas,
            solicitudes y reclamos sobre datos personales se reciben en{' '}
            <a href="mailto:luisaqf31@gmail.com">luisaqf31@gmail.com</a> y en el teléfono{' '}
            <a href="tel:+573117398643">311 739 8643</a>.
          </p>
        </section>

        <section>
          <h2>2. Datos tratados y finalidades</h2>
          <p>
            El salón puede tratar el nombre y, cuando la clienta los suministre, el teléfono y la
            fecha de cumpleaños. También puede conservar información de citas, servicios, productos,
            pagos y observaciones necesarias para prestar y continuar la atención.
          </p>
          <p>Los datos se usan para:</p>
          <ul>
            <li>programar, confirmar y prestar los servicios solicitados;</li>
            <li>mantener el historial de atención y las preferencias de la clienta;</li>
            <li>gestionar cobros, pagos, inventario y obligaciones contables o legales;</li>
            <li>atender consultas, correcciones, reclamos y solicitudes sobre los datos; y</li>
            <li>generar avisos internos de cumpleaños cuando la clienta suministre esa fecha.</li>
          </ul>
          <p>
            Los datos no se usarán para publicidad sin una autorización separada. El cumpleaños es
            opcional.
          </p>
        </section>

        <section>
          <h2>3. Autorización</h2>
          <p>
            Antes de registrar una clienta se presenta un aviso con las finalidades, sus derechos y
            los canales de atención. El tratamiento se realiza después de recibir una autorización
            previa, expresa e informada. El sistema guarda la fecha, la versión del aviso y la
            cuenta que dejó la constancia del registro.
          </p>
          <p>
            La clienta puede negarse a entregar datos opcionales o sensibles. Si fuera necesario
            tratar datos sensibles o datos de niñas, niños o adolescentes, se explicará la finalidad
            y se aplicarán los requisitos especiales correspondientes.
          </p>
        </section>

        <section>
          <h2>4. Derechos de la titular</h2>
          <p>La clienta puede:</p>
          <ul>
            <li>conocer, actualizar y rectificar sus datos;</li>
            <li>solicitar prueba de la autorización otorgada;</li>
            <li>conocer el uso dado a sus datos;</li>
            <li>presentar consultas o reclamos;</li>
            <li>revocar la autorización o solicitar la supresión cuando sea procedente; y</li>
            <li>acceder gratuitamente a los datos tratados.</li>
          </ul>
        </section>

        <section>
          <h2>5. Consultas y reclamos</h2>
          <p>
            La titular o quien esté autorizado puede escribir al correo o comunicarse al teléfono
            indicados en esta política. La solicitud debe incluir el nombre, una descripción clara
            de lo pedido, un medio de respuesta y, cuando corresponda, los documentos que acrediten
            la identidad o representación.
          </p>
          <p>
            Las consultas y reclamos se atenderán dentro de los términos previstos en la legislación
            colombiana. Si la solicitud está incompleta, se pedirá la información necesaria para
            tramitarla.
          </p>
        </section>

        <section>
          <h2>6. Seguridad, acceso y conservación</h2>
          <p>
            Se aplican medidas administrativas y técnicas razonables para limitar el acceso a las
            cuentas autorizadas, proteger la información y reducir riesgos de pérdida, consulta o
            uso no autorizado. Los datos se conservarán mientras sean necesarios para las
            finalidades informadas y durante los plazos exigidos por obligaciones legales o
            contractuales.
          </p>
        </section>

        <section>
          <h2>7. Cambios a esta política</h2>
          <p>
            Los cambios sustanciales se informarán antes de aplicarlos cuando modifiquen las
            finalidades o requieran una nueva autorización. La versión vigente permanecerá
            disponible en esta misma dirección.
          </p>
        </section>

        <footer className="privacy-footer">
          <a className="button-secondary" href="/">
            Volver al inicio
          </a>
        </footer>
      </article>
    </main>
  );
}
