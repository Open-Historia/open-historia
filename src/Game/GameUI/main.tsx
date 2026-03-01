import React from 'react';

const baseStyle: React.CSSProperties = {
    position: 'fixed',
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    backdropFilter: 'blur(4px)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontFamily: 'sans-serif',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.2)',
};

const Time: React.FC = () => {
    return (
        <>
        {/* Date */}
        <div style={{
            ...baseStyle,
            top: '0.5rem',
            right: '0.5rem',

            height: '3.75rem',
            width: '18rem',
        }}>
        March 1st, 2026
        </div>

        {/* Other */}
        <div style={{
            ...baseStyle,
            bottom: '0.5rem',
            left: '0.5rem',

            height: '4rem',
            width: '8.75rem',
        }}/>

        {/* Advisor */}
        <button style={{
            ...baseStyle,
            bottom: '0.5rem',
            right: '0.5rem',

            height: '4rem',
            width: '4rem',

            cursor: 'pointer',
        }}/>

        {/* Settings */}
        <button style={{
            ...baseStyle,
            top: '0.5rem',
            left: '0.5rem',

            height: '4rem',
            width: '4rem',

            cursor: 'pointer',
        }}/>

        </>
    );
};

export default Time;
