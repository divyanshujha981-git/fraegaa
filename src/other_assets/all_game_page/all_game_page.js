import React from "react";
import './all_game_page.css';
import {Link} from 'react-router-dom';


export const AllGamesPage = () => {

    const arr = [
        {name: 'House Block'}
    ]
    

    return (
        <div className="all_game_page_root_container">
            {
                arr.map((item) =>     
                    <Cards name={item.name} />
                )
            }
        </div>
    );
}





class Cards extends React.Component  {
    constructor(props) {
        super(props);
    }
    
    render() {
        return (
            <Link to={'/houseblock/pregame_definition'} className="customLink">
            <div  className="card_container">
                <h2>{this.props.name}</h2>
            </div>
            </Link>

        );
    }
}