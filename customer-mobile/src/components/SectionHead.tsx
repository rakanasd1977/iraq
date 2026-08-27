import { useNavigate } from 'react-router-dom';

export function SectionHead({ icon = '', title = '', badge = '', moreTo = '' }: any) {
  const navigate = useNavigate();
  return (
    <div className="section-head">
      <div className="section-head__title">
        {icon ? <span className="section-head__icon">{icon}</span> : null}
        <span>{title}</span>
        {badge ? <span className="section-head__badge">{badge}</span> : null}
      </div>
      {moreTo ? (
        <button className="section-more" type="button" onClick={() => navigate(moreTo)}>
          المزيد ›
        </button>
      ) : null}
    </div>
  );
}
