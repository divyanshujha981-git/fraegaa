import "react";
import './all_game_page.css';
import {Link} from 'react-router-dom';


// accent / accent2 colour each card; emoji is the picture on the card face
const GAMES = [
    {
        name: 'House Block',
        link: '/houseblock/pregame_definition',
        emoji: '🏠',
        tagline: 'Connect the dots, close the boxes, claim the houses.',
        players: '2–13 players',
        tag: 'Strategy',
        accent: '#4c6ef5',
        accent2: '#15aabf'
    },
    {
        name: 'Mini Kingdom',
        link: '/minikingdom/pregame_definition',
        emoji: '👑',
        tagline: 'King, queen, thief or police? Keep your role secret.',
        players: '4 players',
        tag: 'Bluffing',
        accent: '#7048e8',
        accent2: '#e64980'
    },
]

export const AllGamesPage = () => {

    return (
        <div className="all_game_page_root_container">


            <div className="side left">


            </div>



            <div className="middle">

                <div className="games_head">
                    <h1>Pick a game</h1>
                    <p>Choose a card, then invite your friends with a link.</p>
                </div>

                {
                    GAMES.map((item) =>
                        <Cards key={item.link} {...item} />
                    )
                }

            </div>



            <div className="side right">


            </div>




        </div>
    );
}


const Cards = ({ name, link, emoji, tagline, players, tag, accent, accent2 }) => (
    <Link to={link} className="customLink" aria-label={`Play ${name}`}>
        <div className="card_container" style={{ '--accent': accent, '--accent2': accent2 }}>

            <div className="card_inner">

                <div className="card_corner">
                    <span className="card_pip">{emoji}</span>
                    <span className="card_tag">{tag}</span>
                </div>

                <div className="card_art">
                    <span className="card_emoji">{emoji}</span>
                </div>

                <h2>{name}</h2>
                <p className="card_tagline">{tagline}</p>

                <div className="card_footer">
                    <span className="card_players">{players}</span>
                    <span className="card_play">Play ▸</span>
                </div>

            </div>

        </div>
    </Link>
);
